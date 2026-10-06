package notes

// 노트 잠금의 본문 암호화(src/lib/note-lock.js). 저장 형식은 웹과 같아야 이미 잠근 노트를
// 서로 열 수 있으므로, 형식을 바꾸려면 docs/ENCRYPTION.md의 호환성을 먼저 따른다.
// 형식: base64(버전 바이트 2 + salt 16바이트 + IV 12바이트 + AES-GCM 암호문·태그).

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"os"
	"slices"
	"strconv"
	"strings"
	"sync"
	"unicode/utf16"
	"unicode/utf8"
)

const (
	lockFormatVersion = 2
	lockSaltBytes     = 16
	lockIVBytes       = 12
	lockHeaderBytes   = 1 + lockSaltBytes + lockIVBytes
	lockKDFIterations = 600_000
	lockKeyBytes      = 32
	lockTitleMaxUnits = 256

	// DefaultAppPepper는 공식 pepper다(note-lock.js의 OFFICIAL_APP_PEPPER). note.gitools.net과
	// 설치형 앱이 같은 값을 쓰도록 소스에 고정한 공개값이다.
	DefaultAppPepper = "3e825c25be54fa5431953dd8d708d5951c77eb2213bd09e023ee00614a7f3ce4"
	// LegacyAppPepper는 예전 소스 기본값이다(LEGACY_APP_PEPPER). 열 때만 시도한다.
	LegacyAppPepper = "issue-note-lock::7b1f4e93c8a642d5a0ef36b91472c85d"
	// PepperEnv는 실행 때 pepper를 바꾸는 환경변수다.
	PepperEnv = "GINOTE_NOTE_LOCK_PEPPER"
)

// AppPepper는 배포 pepper다(웹의 VITE_NOTE_LOCK_PEPPER에 해당). 웹 빌드와 같은 값을 써야
// 그 배포의 잠금 노트를 연다. 빌드 때
//
//	go build -ldflags "-X github.com/zidell/ginote/tui/internal/notes.AppPepper=..."
//
// 로 넣고, 실행 때는 GINOTE_NOTE_LOCK_PEPPER 환경변수가 이 값보다 우선한다.
// 둘 다 비어 있으면 DefaultAppPepper를 쓴다.
var AppPepper = DefaultAppPepper

// 웹이 던지는 오류와 같은 문구다.
var (
	ErrInvalidPin         = errors.New("6자리 숫자를 입력해 주세요.")
	ErrIssueNumber        = errors.New("이슈 번호가 필요합니다.")
	ErrMalformedPayload   = errors.New("잠금 데이터 형식을 읽을 수 없습니다.")
	ErrUnsupportedPayload = errors.New("지원하지 않는 잠금 데이터입니다.")
	ErrWrongPin           = errors.New("6자리 숫자가 맞지 않거나 잠긴 이슈가 아닙니다.")
)

var (
	userPepperMu sync.Mutex
	userPepper   string
)

// UsePepper는 설정에서 넣은 배포 pepper다. 자체 배포 서버(VITE_NOTE_LOCK_PEPPER를 바꾼 웹)에서
// 잠근 노트를 열 때 쓴다. 비우면 AppPepper(공식 값)를 쓴다.
func UsePepper(value string) {
	userPepperMu.Lock()
	userPepper = strings.TrimSpace(value)
	userPepperMu.Unlock()
}

// configuredPepper는 환경변수, 설정의 pepper, AppPepper, 기본값 순으로 첫 비어 있지 않은 값이다.
func configuredPepper() string {
	if value := strings.TrimSpace(os.Getenv(PepperEnv)); value != "" {
		return value
	}
	userPepperMu.Lock()
	value := userPepper
	userPepperMu.Unlock()
	if value != "" {
		return value
	}
	if value := strings.TrimSpace(AppPepper); value != "" {
		return value
	}
	return DefaultAppPepper
}

// NormalizeLockPin은 숫자만 남겨 앞 6자리를 쓰고, 6자리가 안 되면 빈 문자열이다(normalizeLockPin).
// JS의 \d처럼 ASCII 숫자만 센다.
func NormalizeLockPin(value string) string {
	digits := make([]byte, 0, 6)
	for i := 0; i < len(value) && len(digits) < 6; i++ {
		if c := value[i]; c >= '0' && c <= '9' {
			digits = append(digits, c)
		}
	}
	if len(digits) != 6 {
		return ""
	}
	return string(digits)
}

// IsLockedPayload는 값이 잠금 암호문 형식인지 본다(isLockedPayload).
func IsLockedPayload(value string) bool {
	packed, err := decodeJSBase64(value)
	return err == nil && len(packed) > lockHeaderBytes && packed[0] == lockFormatVersion
}

// AddLockToTitle은 제목 앞에 잠금 표식을 붙인다(addLockToTitle). 길이 제한 256은 JS처럼
// UTF-16 단위로 센다. 잘린 자리가 서로게이트 쌍 중간이면 그 글자는 뺀다(JS는 반쪽을 남긴다).
func AddLockToTitle(title string) string {
	value := strings.TrimRightFunc(lockPrefix+" "+RemoveLockFromTitle(title), isJSSpace)
	units := 0
	for i, r := range value {
		units += utf16.RuneLen(r)
		if units > lockTitleMaxUnits {
			return value[:i]
		}
	}
	return value
}

// EncryptLockedBody는 본문을 잠금 숫자와 이슈 번호로 암호화한다(encryptLockedBody).
func EncryptLockedBody(body, pin string, issueNumber int) (string, error) {
	normalizedPin, err := requirePin(pin)
	if err != nil {
		return "", err
	}
	context, err := requireIssueNumber(issueNumber)
	if err != nil {
		return "", err
	}
	packed := make([]byte, lockHeaderBytes, lockHeaderBytes+len(body)+16)
	packed[0] = lockFormatVersion
	if _, err := rand.Read(packed[1:lockHeaderBytes]); err != nil {
		return "", err
	}
	salt := packed[1 : 1+lockSaltBytes]
	iv := packed[1+lockSaltBytes : lockHeaderBytes]
	aead, err := lockCipher(normalizedPin, context, configuredPepper(), salt)
	if err != nil {
		return "", err
	}
	packed = aead.Seal(packed, iv, []byte(body), nil)
	return base64.StdEncoding.EncodeToString(packed), nil
}

// DecryptLockedBody는 암호문을 연다(decryptLockedBody). 설정한 pepper로 안 열리면
// 공식 pepper, 예전 기본 pepper 순서로 다시 시도한다.
func DecryptLockedBody(body, pin string, issueNumber int) (string, error) {
	normalizedPin, err := requirePin(pin)
	if err != nil {
		return "", err
	}
	context, err := requireIssueNumber(issueNumber)
	if err != nil {
		return "", err
	}
	packed, err := decodeJSBase64(body)
	if err != nil {
		return "", ErrMalformedPayload
	}
	if len(packed) <= lockHeaderBytes || packed[0] != lockFormatVersion {
		return "", ErrUnsupportedPayload
	}
	salt := packed[1 : 1+lockSaltBytes]
	iv := packed[1+lockSaltBytes : lockHeaderBytes]
	ciphertext := packed[lockHeaderBytes:]
	// 이 설정의 pepper → 공식 → 예전 기본값 순서로 연다(DECRYPT_PEPPERS).
	peppers := []string{configuredPepper()}
	for _, pepper := range []string{DefaultAppPepper, LegacyAppPepper} {
		if !slices.Contains(peppers, pepper) {
			peppers = append(peppers, pepper)
		}
	}
	for _, pepper := range peppers {
		aead, err := lockCipher(normalizedPin, context, pepper, salt)
		if err != nil {
			continue
		}
		plain, err := aead.Open(nil, iv, ciphertext, nil)
		if err != nil {
			continue
		}
		// TextDecoder처럼 깨진 바이트는 U+FFFD로 바꾼다.
		if utf8.Valid(plain) {
			return string(plain), nil
		}
		return strings.ToValidUTF8(string(plain), "�"), nil
	}
	return "", ErrWrongPin
}

func requirePin(pin string) (string, error) {
	normalized := NormalizeLockPin(pin)
	if normalized == "" {
		return "", ErrInvalidPin
	}
	return normalized, nil
}

func requireIssueNumber(issueNumber int) (string, error) {
	if issueNumber <= 0 {
		return "", ErrIssueNumber
	}
	return strconv.Itoa(issueNumber), nil
}

// lockCipher는 deriveKey와 같다: PBKDF2-SHA-256 600,000회로 "pepper:이슈번호:숫자"에서
// AES-256 키를 만든다.
func lockCipher(pin, issueNumber, pepper string, salt []byte) (cipher.AEAD, error) {
	key, err := pbkdf2.Key(sha256.New, pepper+":"+issueNumber+":"+pin, salt, lockKDFIterations, lockKeyBytes)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// decodeJSBase64는 atob처럼 ASCII 공백을 무시하고 끝의 = 패딩을 빼도 받아들인다.
func decodeJSBase64(value string) ([]byte, error) {
	value = strings.Map(func(r rune) rune {
		switch r {
		case '\t', '\n', '\f', '\r', ' ':
			return -1
		}
		return r
	}, value)
	if len(value)%4 == 0 {
		value = strings.TrimSuffix(value, "=")
		value = strings.TrimSuffix(value, "=")
	}
	return base64.RawStdEncoding.DecodeString(value)
}
