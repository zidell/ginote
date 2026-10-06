package notes

import (
	"testing"
	"time"
	_ "time/tzdata"
)

// 기대값은 src/lib/due-date.js를 TZ=America/New_York(일광 절약 시간 경계 확인용)으로 node에서
// 실행해 얻은 값이다(due-date.test.js의 사례 포함).
func withLocal(t *testing.T, name string) {
	t.Helper()
	location, err := time.LoadLocation(name)
	if err != nil {
		t.Fatal(err)
	}
	previous := time.Local
	time.Local = location
	t.Cleanup(func() { time.Local = previous })
}

func TestParseDueDateMatchesWeb(t *testing.T) {
	withLocal(t, "America/New_York")
	cases := []struct{ input, want string }{
		{"Due: 2026-09-23\n본문", "2026-09-23"},
		{"due:2026-09-23", "2026-09-23"},
		{"**Due: 2026-09-23**", "2026-09-23"},
		{"## Due: 2026-9-3", "2026-09-03"},
		{"회의 준비\nDue: 2026-09-23", ""},
		{"Due: 2026-09-23 최종 제출", ""},
		{"Due: 2026-02-30", ""},
		{"Due: 2026-13-01", ""},
		{"Due: 내일", ""},
		{"", ""},
		{"Due: 0050-01-01", ""},
		{"Due: 0100-01-01", "0100-01-01"},
		{"DUE :  2024-02-29", "2024-02-29"},
		{"Due: 2023-02-29", ""},
		{"Due:　2026-01-05", "2026-01-05"},
		{"Due: 2026-00-10", ""},
		{"Due: 2026-1-0", ""},
		{"Due: 2026-03-08\r\nx", "2026-03-08"},
	}
	for _, c := range cases {
		date, ok := ParseDueDate(c.input)
		got := ""
		if ok {
			got = date.Format("2006-01-02")
			if date.Hour() != 0 || date.Minute() != 0 || date.Location() != time.Local {
				t.Errorf("ParseDueDate(%q) = %v, want local midnight", c.input, date)
			}
		}
		if got != c.want {
			t.Errorf("ParseDueDate(%q) = %q, want %q", c.input, got, c.want)
		}
	}
}

func TestDueBadgeLabel(t *testing.T) {
	for days, want := range map[int]string{3: "D-3", 0: "D-DAY", -2: "D+2"} {
		if got := DueBadgeLabel(days); got != want {
			t.Errorf("DueBadgeLabel(%d) = %q, want %q", days, got, want)
		}
	}
}

func TestDueBadgeMatchesWeb(t *testing.T) {
	withLocal(t, "America/New_York")
	now := time.Date(2026, 9, 22, 18, 30, 0, 0, time.Local)
	beforeSpringForward := time.Date(2026, 3, 7, 23, 59, 0, 0, time.Local)
	cases := []struct {
		input string
		now   time.Time
		want  Due
	}{
		{"Due: 2026-09-23", now, Due{1, "D-1", "2026-09-23"}},
		{"Due: 2026-09-22", now, Due{0, "D-DAY", "2026-09-22"}},
		{"Due: 2026-09-20", now, Due{-2, "D+2", "2026-09-20"}},
		{"Due: 2026-10-02", now, Due{10, "D-10", "2026-10-02"}},
		{"Due: 2027-01-01", now, Due{101, "D-101", "2027-01-01"}},
		{"Due: 2026-03-08", beforeSpringForward, Due{1, "D-1", "2026-03-08"}},
		{"Due: 2026-03-09", beforeSpringForward, Due{2, "D-2", "2026-03-09"}},
		{"Due: 2026-11-02", beforeSpringForward, Due{240, "D-240", "2026-11-02"}},
		{"Due: 2025-11-01", beforeSpringForward, Due{-126, "D+126", "2025-11-01"}},
		// 웹은 연도를 채우지 않는다.
		{"Due: 0100-01-01", now, Due{-703721, "D+703721", "100-01-01"}},
	}
	for _, c := range cases {
		got, ok := DueBadge(c.input, c.now)
		if !ok || got != c.want {
			t.Errorf("DueBadge(%q) = %+v %v, want %+v", c.input, got, ok, c.want)
		}
	}
	if _, ok := DueBadge("장보기 목록\n- 우유", now); ok {
		t.Error("DueBadge without due line should be false")
	}
	// now가 다른 시간대여도 time.Local의 날짜로 센다.
	if got := DaysUntilDue(time.Date(2026, 9, 23, 0, 0, 0, 0, time.Local), now.UTC()); got != 1 {
		t.Errorf("DaysUntilDue with UTC now = %d, want 1", got)
	}
}
