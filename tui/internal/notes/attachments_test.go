package notes

import (
	"reflect"
	"testing"
)

// 기대값은 src/lib/attachments.js를 node로 실행해 얻은 값이다.
const attachmentBody = "intro\n<!-- ginote:attachments:start -->\n\n![](https://github.com/o/notes/raw/ginote-assets/.issue-note-assets/issues/3/ab-%ED%95%9C%EA%B8%80%20x.png)\n\n[](https://github.com/o/notes/raw/ginote-assets/.issue-note-assets/issues/3/cd-plan.pdf)\n\n<!-- ginote:attachments:end -->\n\n\n\nbody [x](https://github.com/o/notes/raw/ginote-assets/.issue-note-assets/issues/3/ef-a(1).txt) end"

func TestAttachmentLinksMatchWeb(t *testing.T) {
	if got := AttachmentRawURL("o/notes", ".issue-note-assets/issues/3/ab-한글 x!(1).png"); got != "https://github.com/o/notes/raw/ginote-assets/.issue-note-assets/issues/3/ab-%ED%95%9C%EA%B8%80%20x!(1).png" {
		t.Errorf("raw = %s", got)
	}
	if got := ComposeAttachmentLink("o/notes", "p.JPG", "", ".issue-note-assets/issues/3/p.JPG"); got != "![](https://github.com/o/notes/raw/ginote-assets/.issue-note-assets/issues/3/p.JPG)" {
		t.Errorf("image link = %s", got)
	}
	if got := ComposeAttachmentLink("o/notes", "plan.pdf", "application/pdf", ".issue-note-assets/issues/3/plan.pdf"); got != "[](https://github.com/o/notes/raw/ginote-assets/.issue-note-assets/issues/3/plan.pdf)" {
		t.Errorf("file link = %s", got)
	}
	wantPaths := []string{".issue-note-assets/issues/3/ab-한글 x.png", ".issue-note-assets/issues/3/cd-plan.pdf", ".issue-note-assets/issues/3/ef-a(1"}
	if got := ParseAttachmentPaths(attachmentBody); !reflect.DeepEqual(got, wantPaths) {
		t.Errorf("paths = %q", got)
	}
	if got := StripManagedAttachmentBlocks(attachmentBody); got != "intro\n\nbody [x](https://github.com/o/notes/raw/ginote-assets/.issue-note-assets/issues/3/ef-a(1).txt) end" {
		t.Errorf("strip = %q", got)
	}
	wantManaged := []string{
		"![](https://github.com/o/notes/raw/ginote-assets/.issue-note-assets/issues/3/ab-%ED%95%9C%EA%B8%80%20x.png)",
		"[](https://github.com/o/notes/raw/ginote-assets/.issue-note-assets/issues/3/cd-plan.pdf)",
	}
	if got := ManagedAttachmentLinks(attachmentBody); !reflect.DeepEqual(got, wantManaged) {
		t.Errorf("managed = %q", got)
	}
	if got := WithManagedAttachmentBlock("hello", []string{"[](x)", "![](y)"}); got != "<!-- ginote:attachments:start -->\n\n[](x)\n\n![](y)\n\n<!-- ginote:attachments:end -->\n\nhello" {
		t.Errorf("with block = %q", got)
	}
	if got := WithManagedAttachmentBlock("", []string{"[](x)"}); got != "<!-- ginote:attachments:start -->\n\n[](x)\n\n<!-- ginote:attachments:end -->" {
		t.Errorf("with empty = %q", got)
	}
	compressed := CompressAttachmentLinks(attachmentBody, "o/notes")
	if want := "intro\n<!-- ginote:attachments:start -->\n\n![]({repo}/.issue-note-assets/issues/3/ab-%ED%95%9C%EA%B8%80%20x.png)\n\n[]({repo}/.issue-note-assets/issues/3/cd-plan.pdf)\n\n<!-- ginote:attachments:end -->\n\n\n\nbody [x]({repo}/.issue-note-assets/issues/3/ef-a(1).txt) end"; compressed != want {
		t.Errorf("compress = %q", compressed)
	}
	if got := ExpandAttachmentLinks(compressed, "o/notes"); got != attachmentBody {
		t.Errorf("expand = %q", got)
	}
}
