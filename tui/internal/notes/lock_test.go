package notes

import (
	"errors"
	"strings"
	"testing"
)

type lockVector struct {
	body        string
	pin         string
	issueNumber int
	payload     string
}

// src/lib/note-lock.js의 encryptLockedBody를 node로 실행해 만든 암호문(기본 pepper).
var jsLockVectors = []lockVector{
	{"안녕하세요 🔒 잠긴 노트\n- 항목 👨‍👩‍👧", "123456", 42, "As4Z8jV77Rg6vokAkYj3tV5SGFTcIvBX9fGWPJOuWqNOvxOtDP0gkt4do9PyTX/m5bDRxzfJtan2RwN7tyEMtp0LEYeB5Bssg/DPmWvmATSKQ/1zY6A5ZppTpAaffpk2PAJ1Fv5BVoq0k7U="},
	{"", "000000", 1, "AkLRTXzQOlrJKScyl1HGPbtKqmmMKN9VeTv1kcFYlWzAIvK+BgNBIQvnc8uN"},
	{"plain ascii body", "987654", 123456, "AhyHu3f835OBPY+xrtcK/mJLcvVESPbENlMkrv+csrlfNpyc/ZQxfe3cJ76PJqnA3a821hkFc/pcfptcVg=="},
}

// EncryptLockedBody로 만든 뒤 node의 decryptLockedBody로 열리는 것을 확인한 암호문.
var goLockVectors = []lockVector{
	{"Go에서 잠갔다 ✅ 🧪\n줄바꿈", "246810", 7, "AoZOjmbGvb77YZQb9YCqRfpcZ6XbJIV5OZj4EmPdlf73DkUCCMQwwNmu/UAwhX0FcbUwVB6QRDYth578jCQEkmBdUZgOomH+RX1p/Ug6HDHD3w=="},
	{"", "135790", 99, "AoDCFh1yqYt91geBxCEJF5hDyrJoegPxUVyiurg3Uz1P07u+iKoyHi490G9T"},
}

// VITE_NOTE_LOCK_PEPPER를 "custom-pepper-xyz"로 둔 note-lock.js로 만든 암호문.
var customPepperVector = lockVector{"커스텀 pepper 본문", "112233", 5, "Au7HJrVo+g5rM627ES/PbC8xpRSTbVuPB2Qk+zI+CvmDQw7V0uhgdT/n/Nkc0d5hYZJD6Ug6BPvbtrxTHJL/0e39J6c="}

// usePepper는 테스트 동안 AppPepper를 바꾸고 환경변수를 비운다.
func usePepper(t *testing.T, pepper string) {
	t.Helper()
	t.Setenv(PepperEnv, "")
	previous := AppPepper
	AppPepper = pepper
	t.Cleanup(func() { AppPepper = previous })
}

func TestDecryptLockedBodyMatchesWeb(t *testing.T) {
	usePepper(t, DefaultAppPepper)
	for _, vectors := range [][]lockVector{jsLockVectors, goLockVectors} {
		for _, v := range vectors {
			if !IsLockedPayload(v.payload) {
				t.Errorf("IsLockedPayload(%q) = false", v.payload)
			}
			got, err := DecryptLockedBody(v.payload, v.pin, v.issueNumber)
			if err != nil || got != v.body {
				t.Errorf("DecryptLockedBody(#%d) = %q, %v, want %q", v.issueNumber, got, err, v.body)
			}
		}
	}
}

func TestEncryptLockedBodyRoundTrip(t *testing.T) {
	usePepper(t, DefaultAppPepper)
	body := "왕복 테스트 🔐\r\n두 번째 줄"
	payload, err := EncryptLockedBody(body, "12-34-56", 314)
	if err != nil {
		t.Fatal(err)
	}
	// 1 + 16 + 12 + 본문 + 태그 16바이트, 표준 base64(패딩 포함)
	if want := (lockHeaderBytes + len(body) + 16 + 2) / 3 * 4; len(payload) != want {
		t.Errorf("payload length = %d, want %d", len(payload), want)
	}
	if !strings.HasPrefix(payload, "A") || !IsLockedPayload(payload) {
		t.Errorf("payload %q is not version 2", payload)
	}
	got, err := DecryptLockedBody(payload, "123456", 314)
	if err != nil || got != body {
		t.Errorf("round trip = %q, %v", got, err)
	}
	other, _ := EncryptLockedBody(body, "123456", 314)
	if other == payload {
		t.Error("salt·IV가 매번 달라야 한다")
	}
}

func TestDecryptLockedBodyRejectsWrongKey(t *testing.T) {
	usePepper(t, DefaultAppPepper)
	v := jsLockVectors[2]
	if _, err := DecryptLockedBody(v.payload, "987655", v.issueNumber); !errors.Is(err, ErrWrongPin) {
		t.Errorf("wrong pin err = %v", err)
	}
	if _, err := DecryptLockedBody(v.payload, v.pin, v.issueNumber+1); !errors.Is(err, ErrWrongPin) {
		t.Errorf("wrong issue err = %v", err)
	}
}

func TestDecryptLockedBodyPepperFallback(t *testing.T) {
	usePepper(t, "custom-pepper-xyz")
	v := customPepperVector
	if got, err := DecryptLockedBody(v.payload, v.pin, v.issueNumber); err != nil || got != v.body {
		t.Errorf("custom pepper = %q, %v", got, err)
	}
	// 설정 pepper로 안 열리면 기본 pepper로 연다.
	d := jsLockVectors[2]
	if got, err := DecryptLockedBody(d.payload, d.pin, d.issueNumber); err != nil || got != d.body {
		t.Errorf("default pepper fallback = %q, %v", got, err)
	}

	// 환경변수가 AppPepper보다 우선한다.
	AppPepper = DefaultAppPepper
	t.Setenv(PepperEnv, "  custom-pepper-xyz \n")
	if got, err := DecryptLockedBody(v.payload, v.pin, v.issueNumber); err != nil || got != v.body {
		t.Errorf("env pepper = %q, %v", got, err)
	}

	// 기본 pepper만 쓰면 다른 pepper의 암호문은 열리지 않는다.
	t.Setenv(PepperEnv, "")
	if _, err := DecryptLockedBody(v.payload, v.pin, v.issueNumber); !errors.Is(err, ErrWrongPin) {
		t.Errorf("default-only err = %v", err)
	}
}

func TestLockInputValidation(t *testing.T) {
	valid := jsLockVectors[0].payload
	cases := []struct {
		payload, pin string
		issue        int
		want         error
	}{
		{valid, "12345", 42, ErrInvalidPin},
		{valid, "１２３４５６", 42, ErrInvalidPin},
		{valid, "", 42, ErrInvalidPin},
		{valid, "123456", 0, ErrIssueNumber},
		{valid, "123456", -3, ErrIssueNumber},
		{"!!", "123456", 42, ErrMalformedPayload},
		{"A", "123456", 42, ErrMalformedPayload},
		{"", "123456", 42, ErrUnsupportedPayload},
		{"AQ==", "123456", 42, ErrUnsupportedPayload},
		{"Ag==", "123456", 42, ErrUnsupportedPayload},
	}
	for _, c := range cases {
		if _, err := DecryptLockedBody(c.payload, c.pin, c.issue); !errors.Is(err, c.want) {
			t.Errorf("DecryptLockedBody(%q, %q, %d) err = %v, want %v", c.payload, c.pin, c.issue, err, c.want)
		}
	}
	if _, err := EncryptLockedBody("x", "1234", 1); !errors.Is(err, ErrInvalidPin) {
		t.Errorf("encrypt pin err = %v", err)
	}
	if _, err := EncryptLockedBody("x", "123456", 0); !errors.Is(err, ErrIssueNumber) {
		t.Errorf("encrypt issue err = %v", err)
	}
}

// 기대값은 node로 실행한 normalizeLockPin·isLockedPayload·addLockToTitle의 결과다.
func TestLockHelpersMatchWeb(t *testing.T) {
	pins := map[string]string{
		"12-34-56":     "123456",
		"1234567":      "123456",
		"12345":        "",
		"１２３４５６":       "",
		"abc123def456": "123456",
		" 123456 ":     "123456",
	}
	for input, want := range pins {
		if got := NormalizeLockPin(input); got != want {
			t.Errorf("NormalizeLockPin(%q) = %q, want %q", input, got, want)
		}
	}

	for _, value := range []string{"", "Ag==", "!!"} {
		if IsLockedPayload(value) {
			t.Errorf("IsLockedPayload(%q) = true", value)
		}
	}
	// atob처럼 공백과 빠진 패딩을 받아들인다.
	if p := jsLockVectors[2].payload; !IsLockedPayload(strings.TrimRight(p, "=")) || !IsLockedPayload(p[:20]+"\n "+p[20:]) {
		t.Error("IsLockedPayload는 atob처럼 너그러워야 한다")
	}

	titles := map[string]string{
		"":                              "🔒",
		"제목":                            "🔒 제목",
		"🔒 제목":                          "🔒 제목",
		"🔒제목  ":                         "🔒 제목",
		"   ":                           "🔒",
		strings.Repeat("a", 300):        "🔒 " + strings.Repeat("a", 253),
		strings.Repeat("가", 253) + "😀😀": "🔒 " + strings.Repeat("가", 253),
		strings.Repeat("가", 252) + "😀":  "🔒 " + strings.Repeat("가", 252),
	}
	for input, want := range titles {
		if got := AddLockToTitle(input); got != want {
			t.Errorf("AddLockToTitle(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestUsePepperOpensSelfHostedNotes(t *testing.T) {
	t.Cleanup(func() { UsePepper("") })
	UsePepper("self-hosted-pepper")
	sealed, err := EncryptLockedBody("비밀", "123456", 7)
	if err != nil {
		t.Fatal(err)
	}
	UsePepper("")
	if _, err := DecryptLockedBody(sealed, "123456", 7); err != ErrWrongPin {
		t.Fatalf("the official pepper cannot open it: %v", err)
	}
	UsePepper(" self-hosted-pepper ")
	if plain, err := DecryptLockedBody(sealed, "123456", 7); err != nil || plain != "비밀" {
		t.Fatalf("plain = %q err = %v", plain, err)
	}
}
