package notes

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"time"
)

// src/lib/due-date.js를 옮긴 것이다. 날짜는 웹의 new Date(y, m, d)처럼 time.Local 기준이다.

var dueLinePattern = regexp.MustCompile(`(?i)^due[` + jsSpaceChars + `]*:[` + jsSpaceChars + `]*(\d{4})-(\d{1,2})-(\d{1,2})$`)

const millisecondsPerDay = 86400000

// ParseDueDate는 parseDueDate와 같다. 첫 줄이 "Due: YYYY-MM-DD"면 그날 0시(time.Local)를 낸다.
func ParseDueDate(value string) (time.Time, bool) {
	match := dueLinePattern.FindStringSubmatch(MarkdownToPlainText(firstLine(value)))
	if match == nil {
		return time.Time{}, false
	}
	year, _ := strconv.Atoi(match[1])
	month, _ := strconv.Atoi(match[2])
	day, _ := strconv.Atoi(match[3])
	// JS의 new Date(y, ...)는 0~99년을 1900년대로 바꾸므로 원본의 검사에서 항상 걸러진다.
	if year < 100 {
		return time.Time{}, false
	}
	date := time.Date(year, time.Month(month), day, 0, 0, 0, 0, time.Local)
	if date.Year() != year || int(date.Month()) != month || date.Day() != day {
		return time.Time{}, false
	}
	return date, true
}

// DaysUntilDue는 daysUntilDue와 같다: now가 속한 날(time.Local) 0시부터 due까지의 날 수를
// 반올림한다. 일광 절약 시간으로 하루가 23·25시간이어도 날짜 차이가 된다.
func DaysUntilDue(due, now time.Time) int {
	now = now.In(time.Local)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local)
	days := float64(due.UnixMilli()-today.UnixMilli()) / millisecondsPerDay
	return int(math.Floor(days + 0.5))
}

// DueBadgeLabel은 dueBadgeLabel과 같다: D-3, D-DAY, D+2.
func DueBadgeLabel(days int) string {
	switch {
	case days == 0:
		return "D-DAY"
	case days > 0:
		return fmt.Sprintf("D-%d", days)
	default:
		return fmt.Sprintf("D+%d", -days)
	}
}

// Due는 dueBadge의 결과다. Date는 "YYYY-MM-DD"다.
type Due struct {
	Days  int
	Label string
	Date  string
}

// DueBadge는 dueBadge와 같다. 마감 표기가 없으면 false다.
func DueBadge(value string, now time.Time) (Due, bool) {
	due, ok := ParseDueDate(value)
	if !ok {
		return Due{}, false
	}
	days := DaysUntilDue(due, now)
	return Due{
		Days:  days,
		Label: DueBadgeLabel(days),
		Date:  fmt.Sprintf("%d-%02d-%02d", due.Year(), int(due.Month()), due.Day()),
	}, true
}
