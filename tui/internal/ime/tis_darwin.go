//go:build darwin && cgo

package ime

/*
#cgo LDFLAGS: -framework Carbon -framework CoreFoundation
#include <Carbon/Carbon.h>
#include <stdlib.h>

static int copyID(TISInputSourceRef src, char *buf, int size) {
	if (!src) return 0;
	CFStringRef id = (CFStringRef)TISGetInputSourceProperty(src, kTISPropertyInputSourceID);
	int ok = id && CFStringGetCString(id, buf, size, kCFStringEncodingUTF8);
	CFRelease(src);
	return ok;
}

static int currentID(char *buf, int size) { return copyID(TISCopyCurrentKeyboardInputSource(), buf, size); }
// asciiID는 바꿀 영문 입력 소스다. 지금 입력기에 영문 모드가 있으면(구름의 Gureum.system 등)
// 그것을, 없으면 시스템의 영문 자판(ABC 등)을 고른다.
static int asciiID(char *buf, int size) {
	TISInputSourceRef current = TISCopyCurrentKeyboardInputSource();
	CFStringRef bundle = current ? (CFStringRef)TISGetInputSourceProperty(current, kTISPropertyBundleID) : NULL;
	int found = 0;
	if (bundle) {
		const void *keys[] = { kTISPropertyBundleID };
		const void *values[] = { bundle };
		CFDictionaryRef filter = CFDictionaryCreate(NULL, keys, values, 1, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
		CFArrayRef list = TISCreateInputSourceList(filter, false);
		for (CFIndex i = 0; list && i < CFArrayGetCount(list) && !found; i++) {
			TISInputSourceRef candidate = (TISInputSourceRef)CFArrayGetValueAtIndex(list, i);
			CFBooleanRef ascii = (CFBooleanRef)TISGetInputSourceProperty(candidate, kTISPropertyInputSourceIsASCIICapable);
			CFBooleanRef selectable = (CFBooleanRef)TISGetInputSourceProperty(candidate, kTISPropertyInputSourceIsSelectCapable);
			if (ascii && CFBooleanGetValue(ascii) && selectable && CFBooleanGetValue(selectable)) {
				CFRetain(candidate);
				found = copyID(candidate, buf, size);
			}
		}
		if (list) CFRelease(list);
		CFRelease(filter);
	}
	if (current) CFRelease(current);
	return found || copyID(TISCopyCurrentASCIICapableKeyboardLayoutInputSource(), buf, size);
}

static int currentIsASCII(void) {
	TISInputSourceRef src = TISCopyCurrentKeyboardInputSource();
	if (!src) return 1;
	CFBooleanRef ascii = (CFBooleanRef)TISGetInputSourceProperty(src, kTISPropertyInputSourceIsASCIICapable);
	int result = ascii && CFBooleanGetValue(ascii);
	CFRelease(src);
	return result;
}

static int selectID(const char *value) {
	CFStringRef id = CFStringCreateWithCString(NULL, value, kCFStringEncodingUTF8);
	const void *keys[] = { kTISPropertyInputSourceID };
	const void *values[] = { id };
	CFDictionaryRef filter = CFDictionaryCreate(NULL, keys, values, 1, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
	CFArrayRef list = TISCreateInputSourceList(filter, false);
	int status = -1;
	if (list && CFArrayGetCount(list) > 0) {
		status = TISSelectInputSource((TISInputSourceRef)CFArrayGetValueAtIndex(list, 0));
	}
	if (list) CFRelease(list);
	CFRelease(filter);
	CFRelease(id);
	return status;
}
*/
import "C"

import (
	"errors"
	"runtime"
	"unsafe"
)

// 입력 소스 API는 메인 스레드에서 불러야 안전하다. 하위 프로세스(Main)에서만 부르고,
// 그 프로세스의 main 고루틴을 메인 스레드에 묶어 둔다.
func init() { runtime.LockOSThread() }

const supported = true

func readID(read func(*C.char, C.int) C.int) string {
	buf := (*C.char)(C.malloc(256))
	defer C.free(unsafe.Pointer(buf))
	if read(buf, 256) == 0 {
		return ""
	}
	return C.GoString(buf)
}

func currentSource() string {
	return readID(func(buf *C.char, size C.int) C.int { return C.currentID(buf, size) })
}

func asciiSource() string {
	return readID(func(buf *C.char, size C.int) C.int { return C.asciiID(buf, size) })
}

func currentIsASCII() bool { return C.currentIsASCII() != 0 }

func selectSource(id string) error {
	value := C.CString(id)
	defer C.free(unsafe.Pointer(value))
	if C.selectID(value) != 0 {
		return errors.New("입력 소스를 바꾸지 못했습니다: " + id)
	}
	return nil
}
