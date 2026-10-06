package notes

import "strings"

// TagDefinition은 "태그명: 분류 설명" 입력을 나눈 것이다(src/lib/tag-definition.js).
type TagDefinition struct {
	Name        string
	Description string
}

// FormatTagDefinition은 formatTagDefinition과 같다.
func FormatTagDefinition(name, description string) string {
	if description != "" {
		return name + ": " + description
	}
	return name
}

// ParseTagDefinition은 parseTagDefinition과 같다. currentName이 있으면 그 이름에 :가 있어도
// "기존 이름: 설명" 형식으로 읽는다.
func ParseTagDefinition(value, currentName string) TagDefinition {
	source := jsTrim(value)
	currentName = jsTrim(currentName)
	if currentName != "" && source == currentName {
		return TagDefinition{Name: currentName}
	}
	if currentName != "" && strings.HasPrefix(source, currentName+":") {
		return TagDefinition{Name: currentName, Description: jsTrim(source[len(currentName)+1:])}
	}
	name, description, found := strings.Cut(source, ":")
	if !found {
		return TagDefinition{Name: jsTrim(source)}
	}
	return TagDefinition{Name: jsTrim(name), Description: jsTrim(description)}
}
