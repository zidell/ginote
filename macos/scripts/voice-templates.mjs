// 음성 정제 프롬프트·프리셋을 웹 코드에서 뽑아 Swift 소스로 만든다. 긴 한국어 문구를 손으로
// 옮기다 어긋나지 않게 하려는 것이다. make-fixtures.mjs가 부른다.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from './web-modules.mjs';

export const VOICE_SWIFT = join(repoRoot, 'macos/Packages/GinoteCore/Sources/GinoteCore/Voice/VoicePresets.generated.swift');
const RULES = '\u0001RULES\u0001';
const TRANSCRIPT = '\u0001TRANSCRIPT\u0001';

async function captureRefinementRequest() {
  const { refineTranscript } = await import(pathToFileURL(join(repoRoot, 'src/lib/openai-voice.js')).href);
  const original = globalThis.fetch;
  let body;
  globalThis.fetch = async (url, options) => {
    body = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"title":"","body":"","tags":[]}' } }] }));
  };
  try {
    await refineTranscript('sk', TRANSCRIPT, RULES, 'model', undefined, [{ name: 'TAGS' }]);
  } finally {
    globalThis.fetch = original;
  }
  return body;
}

function split(text, marker) {
  const parts = text.split(marker);
  if (parts.length !== 2) throw new Error(`marker ${JSON.stringify(marker)} not found exactly once`);
  return parts;
}

function swiftRaw(value) {
  if (value.includes('"""#')) throw new Error('unexpected raw string delimiter');
  return `#"""\n${value}\n"""#`;
}

export async function voiceSwiftSource() {
  const settings = await import(pathToFileURL(join(repoRoot, 'src/lib/voice-settings.js')).href);
  const legacy = await import(pathToFileURL(join(repoRoot, 'src/lib/voice-refinement-legacy-prompts.js')).href);
  const request = await captureRefinementRequest();
  const [systemPrefix, systemSuffix] = split(request.messages[0].content, RULES);
  const user = request.messages[1].content;
  const tagsJSON = JSON.stringify([{ name: 'TAGS' }]);
  const [userPrefix, userRest] = split(user, tagsJSON);
  const [userMiddle, userSuffix] = split(userRest, TRANSCRIPT);
  const list = (values) => `[\n${values.map((value) => `        ${swiftRaw(value)}`).join(',\n')}\n    ]`;
  const strings = (values) => `[${values.map((value) => JSON.stringify(value)).join(', ')}]`;

  return `// 자동 생성: node macos/scripts/make-fixtures.mjs (원본 src/lib/voice-settings.js,
// voice-refinement-legacy-prompts.js, openai-voice.js). 직접 고치지 않는다.

public enum VoicePresets {
    public static let defaultTranscriptionModel = ${JSON.stringify(settings.DEFAULT_TRANSCRIPTION_MODEL)}
    public static let defaultRefinementModel = ${JSON.stringify(settings.DEFAULT_REFINEMENT_MODEL)}
    public static let defaultTranscriptionModels: [String] = ${strings(settings.DEFAULT_VOICE_MODEL_LISTS.transcription)}
    public static let defaultRefinementModels: [String] = ${strings(settings.DEFAULT_VOICE_MODEL_LISTS.refinement)}

    /// 약함: 오타·띄어쓰기만 바로잡는다(기본값).
    public static let typoCorrectionPrompt = ${swiftRaw(settings.TYPO_CORRECTION_REFINEMENT_PROMPT)}
    /// 중간: 직접 쓴 메모처럼 정리한다.
    public static let writtenStylePrompt = ${swiftRaw(settings.WRITTEN_STYLE_REFINEMENT_PROMPT)}
    /// 강함: 결론·결정 중심으로 정리한다.
    public static let conclusionFocusedPrompt = ${swiftRaw(settings.CONCLUSION_FOCUSED_REFINEMENT_PROMPT)}
    public static let defaultRefinementPrompt = typoCorrectionPrompt

    static let supersededTypoPrompts: [String] = ${list(legacy.SUPERSEDED_TYPO_PROMPTS)}
    static let supersededWrittenPrompts: [String] = ${list(legacy.SUPERSEDED_WRITTEN_PROMPTS)}
    static let supersededConclusionPrompts: [String] = ${list(legacy.SUPERSEDED_CONCLUSION_PROMPTS)}

    /// 정제 요청의 시스템 프롬프트 = prefix + 사용자 규칙 + suffix.
    static let systemPromptPrefix = ${swiftRaw(systemPrefix)}
    static let systemPromptSuffix = ${swiftRaw(systemSuffix)}
    /// 사용자 메시지 = prefix + 태그 JSON + middle + 전사문 + suffix.
    static let userInputPrefix = ${swiftRaw(userPrefix)}
    static let userInputMiddle = ${swiftRaw(userMiddle)}
    static let userInputSuffix = ${swiftRaw(userSuffix)}
    static let responseFormatJSON = ${swiftRaw(JSON.stringify(request.response_format))}
}
`;
}
