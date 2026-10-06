package ui

import (
	"fmt"
	"testing"
)

func TestThumbCacheKeepsOnlyRecentThumbnails(t *testing.T) {
	cache := newThumbCache()
	for index := 0; index < thumbMaxKept+2; index++ {
		path := fmt.Sprintf("p%d", index)
		cache.items[path] = &thumbState{used: uint64(index + 1)}
		cache.rendered[path+"|true"] = []string{"x"}
	}
	cache.items["p0"].uploaded, cache.items["p0"].id = true, 7
	cache.items["p1"].loading = true
	cache.clock = uint64(thumbMaxKept + 2)

	if _, ok := cache.get("p2"); !ok {
		t.Fatal("p2 is cached")
	}
	deleted := cache.evictLocked()
	if len(cache.items) != thumbMaxKept {
		t.Fatalf("keeps %d thumbnails, want %d", len(cache.items), thumbMaxKept)
	}
	if len(deleted) != 1 || deleted[0] != 7 {
		t.Fatalf("the uploaded image is deleted from the terminal: %v", deleted)
	}
	for _, path := range []string{"p0", "p3"} {
		if _, ok := cache.items[path]; ok {
			t.Fatalf("%s is the least recently used and is dropped", path)
		}
	}
	if _, ok := cache.rendered["p0|true"]; ok {
		t.Fatal("the drawn thumbnail is dropped too")
	}
	for _, path := range []string{"p1", "p2"} {
		if _, ok := cache.items[path]; !ok {
			t.Fatalf("%s is kept (loading or recently used)", path)
		}
	}
	if deleteKittyImages(nil) != nil || deleteKittyImages(deleted) == nil {
		t.Fatal("a delete command is sent only for uploaded images")
	}
}

func TestVoiceKeepsASingleTickChain(t *testing.T) {
	v := &voiceState{gen: 1, phase: "recording", rec: &fakeRecorder{}}
	if v.startTick() == nil || v.startTick() != nil {
		t.Fatal("a second tick is not started while one is pending")
	}
	m := Model{voice: v}
	v.phase = "paused"
	if _, cmd, _ := m.handleVoiceMsg(voiceTickMsg{gen: 1}); cmd != nil || v.ticking {
		t.Fatal("the chain ends while paused")
	}
	if v.startTick() == nil {
		t.Fatal("resuming starts a new chain")
	}
}
