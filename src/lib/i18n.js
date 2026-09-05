import { get } from 'svelte/store';
import { _, addMessages, init, locale } from 'svelte-i18n';
import en from './locales/en.json';
import ko from './locales/ko.json';
import zh from './locales/zh-CN.json';

export const LOCALE_OPTIONS = [
  { value: 'auto', label: 'Automatic / 자동' },
  { value: 'en', label: 'English' },
  { value: 'ko', label: '한국어' },
  { value: 'zh-CN', label: '简体中文' },
  { value: 'ja', label: '日本語' },
  { value: 'de', label: 'Deutsch' },
  { value: 'fr', label: 'Français' },
  { value: 'it', label: 'Italiano' }
];

const common = {
  ja: { Add: '追加', Attach: '添付', 'Back to list': '一覧に戻る', Clear: 'クリア', Close: '閉じる', Copy: 'コピー', Delete: '削除', Download: 'ダウンロード', 'Editor settings': 'エディター設定', Font: 'フォント', List: '一覧', 'Load more': 'さらに読み込む', 'Loading notes…': 'ノートを読み込み中…', 'Manage tags': 'タグ管理', 'New note': '新しいノート', 'New tag name': '新しいタグ名', Notes: 'ノート', 'Notes per page': '1ページのノート数', Refresh: '更新', Restore: '復元', Saved: '保存済み', 'Saving...': '保存中...', Search: '検索', Settings: '設定', Tags: 'タグ', Trash: 'ゴミ箱', 'Auto-save delay': '自動保存までの時間', 'Line height': '行間', Size: 'サイズ', 'Save settings': '設定を保存', 'Title mode': 'タイトル方式', 'Write your note…': 'ノートを入力…', 'Select a note from the list.': '左の一覧からノートを選択してください。', 'No notes yet.': 'ノートはまだありません。', 'No results found.': '検索結果がありません。', 'Search or #tag': '検索または #タグ', 'Connect and start': '接続して開始', 'Connect a GitHub repository': 'GitHubリポジトリに接続', 'Remember PAT in this browser': 'このブラウザにPATを保存', 'Notes repository': 'ノート用リポジトリ' },
  de: { Add: 'Hinzufügen', Attach: 'Anhängen', 'Back to list': 'Zurück zur Liste', Clear: 'Leeren', Close: 'Schließen', Copy: 'Kopieren', Delete: 'Löschen', Download: 'Herunterladen', 'Editor settings': 'Editor-Einstellungen', Font: 'Schriftart', List: 'Liste', 'Load more': 'Mehr laden', 'Loading notes…': 'Notizen werden geladen…', 'Manage tags': 'Tags verwalten', 'New note': 'Neue Notiz', 'New tag name': 'Neuer Tag-Name', Notes: 'Notizen', 'Notes per page': 'Notizen pro Seite', Refresh: 'Aktualisieren', Restore: 'Wiederherstellen', Saved: 'Gespeichert', 'Saving...': 'Wird gespeichert...', Search: 'Suchen', Settings: 'Einstellungen', Tags: 'Tags', Trash: 'Papierkorb', 'Auto-save delay': 'Verzögerung der automatischen Speicherung', 'Line height': 'Zeilenhöhe', Size: 'Größe', 'Save settings': 'Einstellungen speichern', 'Title mode': 'Titelmodus', 'Write your note…': 'Notiz schreiben…', 'Select a note from the list.': 'Wählen Sie links eine Notiz aus.', 'No notes yet.': 'Noch keine Notizen.', 'No results found.': 'Keine Ergebnisse gefunden.', 'Search or #tag': 'Suchen oder #Tag', 'Connect and start': 'Verbinden und starten', 'Connect a GitHub repository': 'GitHub-Repository verbinden', 'Remember PAT in this browser': 'PAT in diesem Browser speichern', 'Notes repository': 'Notiz-Repository' },
  fr: { Add: 'Ajouter', Attach: 'Joindre', 'Back to list': 'Retour à la liste', Clear: 'Effacer', Close: 'Fermer', Copy: 'Copier', Delete: 'Supprimer', Download: 'Télécharger', 'Editor settings': 'Paramètres de l’éditeur', Font: 'Police', List: 'Liste', 'Load more': 'Charger plus', 'Loading notes…': 'Chargement des notes…', 'Manage tags': 'Gérer les tags', 'New note': 'Nouvelle note', 'New tag name': 'Nouveau tag', Notes: 'Notes', 'Notes per page': 'Notes par page', Refresh: 'Actualiser', Restore: 'Restaurer', Saved: 'Enregistré', 'Saving...': 'Enregistrement...', Search: 'Rechercher', Settings: 'Paramètres', Tags: 'Tags', Trash: 'Corbeille', 'Auto-save delay': 'Délai d’enregistrement automatique', 'Line height': 'Interligne', Size: 'Taille', 'Save settings': 'Enregistrer les paramètres', 'Title mode': 'Mode de titre', 'Write your note…': 'Écrivez votre note…', 'Select a note from the list.': 'Sélectionnez une note dans la liste.', 'No notes yet.': 'Aucune note pour le moment.', 'No results found.': 'Aucun résultat.', 'Search or #tag': 'Rechercher ou #tag', 'Connect and start': 'Connecter et commencer', 'Connect a GitHub repository': 'Connecter un dépôt GitHub', 'Remember PAT in this browser': 'Mémoriser le PAT dans ce navigateur', 'Notes repository': 'Dépôt des notes' },
  it: { Add: 'Aggiungi', Attach: 'Allega', 'Back to list': 'Torna alla lista', Clear: 'Cancella', Close: 'Chiudi', Copy: 'Copia', Delete: 'Elimina', Download: 'Scarica', 'Editor settings': 'Impostazioni dell’editor', Font: 'Carattere', List: 'Elenco', 'Load more': 'Carica altro', 'Loading notes…': 'Caricamento note…', 'Manage tags': 'Gestisci tag', 'New note': 'Nuova nota', 'New tag name': 'Nuovo tag', Notes: 'Note', 'Notes per page': 'Note per pagina', Refresh: 'Aggiorna', Restore: 'Ripristina', Saved: 'Salvato', 'Saving...': 'Salvataggio...', Search: 'Cerca', Settings: 'Impostazioni', Tags: 'Tag', Trash: 'Cestino', 'Auto-save delay': 'Ritardo salvataggio automatico', 'Line height': 'Interlinea', Size: 'Dimensione', 'Save settings': 'Salva impostazioni', 'Title mode': 'Modalità titolo', 'Write your note…': 'Scrivi la nota…', 'Select a note from the list.': 'Seleziona una nota dalla lista.', 'No notes yet.': 'Nessuna nota.', 'No results found.': 'Nessun risultato.', 'Search or #tag': 'Cerca o #tag', 'Connect and start': 'Connetti e inizia', 'Connect a GitHub repository': 'Connetti un repository GitHub', 'Remember PAT in this browser': 'Ricorda il PAT in questo browser', 'Notes repository': 'Repository delle note' }
};

const dynamic = {
  en: { noteCount: '{count} notes', openNote: 'Open note {title}', clearFilter: 'Clear {label} filter', tagName: '{name} tag name', createTag: 'Create #{name}', tagAdded: 'Added #{name}.', tagDeleted: 'Deleted #{name}.', tagRenamed: 'Renamed #{from} to #{to}.', tagNameRequired: 'The name of #{name} cannot be empty.', selectOwner: 'Select the {owner} account.', selectRepository: 'Select only {repo}.', createPat: 'Create a PAT for {name}', allocateFailed: 'Could not allocate a number for the new note. {error}', moveToTrashConfirm: 'Move “{title}” to trash?', restoreConfirm: 'Restore “{title}”?', attachmentLimit: 'Each note can have up to {count} attachments.', attachmentLimitAdded: 'Only {count} attachments were added because that is the per-note limit.', fileTooLarge: '“{name}” was not uploaded because it exceeds 10 MB.', deleteAttachmentConfirm: 'Delete “{name}” from the repository too?', deleteAttachment: 'Delete attachment {name}', uploading: 'Uploading ({count})', removeTag: 'Remove tag {name}', openLink: 'Open {url} in a new tab', pasteLocationRequired: 'Place the cursor where you want to paste first.', createdAt: 'Created: {date}', updatedAt: 'Updated: {date}', viewOnGitHub: 'View on GitHub', mcpPrompt: 'Use GitHub Issues in {repo} as notes. Open issues are regular notes, closed issues are trash, and labels are tags. Each attachment is stored under .issue-note-assets/issues/{issueNumber}/ and linked to one dedicated issue comment containing an <!-- issue-note-attachment:... --> marker. This comment is an internal record used by the app for the attachment list and GitHub preview; do not interpret, edit, or delete it as a regular comment. The issue body contains only the note text without attachment metadata.' },
  ko: { noteCount: '{count}개', openNote: '{title} 노트 열기', clearFilter: '{label} 필터 해제', tagName: '{name} 태그 이름', createTag: '#{name} 새로 만들기', tagAdded: '#{name} 태그를 추가했습니다.', tagDeleted: '#{name} 태그를 삭제했습니다.', tagRenamed: '#{from} 태그를 #{to}(으)로 변경했습니다.', tagNameRequired: '#{name} 태그 이름을 비워둘 수 없습니다.', selectOwner: '{owner} 계정이 선택되어야 합니다.', selectRepository: '{repo} 저장소 하나만 선택하세요.', createPat: '{name}용 PAT 발급하기', allocateFailed: '새 노트 번호를 만들지 못했습니다. {error}', moveToTrashConfirm: '“{title}” 노트를 휴지통으로 이동할까요?', restoreConfirm: '“{title}” 노트를 복원할까요?', attachmentLimit: '첨부파일은 노트당 최대 {count}개까지 추가할 수 있습니다.', attachmentLimitAdded: '첨부파일은 노트당 최대 {count}개까지만 추가했습니다.', fileTooLarge: '“{name}”은 10MB를 초과하여 올리지 않았습니다.', deleteAttachmentConfirm: '“{name}” 파일을 저장소에서도 삭제할까요?', deleteAttachment: '{name} 첨부 삭제', uploading: '업로드 중 ({count})', removeTag: '{name} 태그 제거', openLink: '{url} 새 탭에서 열기', pasteLocationRequired: '붙여넣을 위치를 먼저 지정하세요.', createdAt: '생성: {date}', updatedAt: '수정: {date}', viewOnGitHub: 'GitHub에서 보기', mcpPrompt: '{repo} 저장소의 GitHub Issues를 노트로 사용해줘. 열린 이슈는 일반 노트, 닫힌 이슈는 휴지통이며 라벨은 태그야. 각 첨부파일은 .issue-note-assets/issues/{issueNumber}/ 폴더에 저장되고, 해당 이슈에는 <!-- issue-note-attachment:... --> 마커가 있는 전용 댓글 하나가 연결돼. 이 댓글은 앱이 첨부파일 목록과 GitHub 미리보기를 관리하는 내부 레코드이므로 일반 댓글로 해석하거나 수정·삭제하지 말아줘. 이슈 본문은 첨부 메타데이터 없이 노트 내용만 들어 있어.' }
};

const dynamicOverrides = {
  'zh-CN': { noteCount: '{count} 条笔记', openNote: '打开笔记 {title}', clearFilter: '清除 {label} 筛选', tagName: '{name} 标签名称', createTag: '创建 #{name}', tagAdded: '已添加 #{name}。', tagDeleted: '已删除 #{name}。', tagRenamed: '已将 #{from} 重命名为 #{to}。', tagNameRequired: '#{name} 的名称不能为空。', selectOwner: '请选择 {owner} 账户。', selectRepository: '仅选择 {repo}。', createPat: '为 {name} 创建 PAT', allocateFailed: '无法为新笔记分配编号。{error}', moveToTrashConfirm: '将“{title}”移至回收站？', restoreConfirm: '恢复“{title}”？', attachmentLimit: '每条笔记最多可有 {count} 个附件。', attachmentLimitAdded: '由于每条笔记的限制，仅添加了 {count} 个附件。', fileTooLarge: '“{name}”超过 10 MB，未上传。', deleteAttachmentConfirm: '也从仓库中删除“{name}”？', deleteAttachment: '删除附件 {name}', uploading: '上传中（{count}）', removeTag: '移除标签 {name}', openLink: '在新标签页中打开 {url}' },
  ja: { noteCount: '{count}件', openNote: 'ノート「{title}」を開く', clearFilter: '{label} フィルターを解除', tagName: '{name} のタグ名', createTag: '#{name} を作成', tagAdded: '#{name} を追加しました。', tagDeleted: '#{name} を削除しました。', tagRenamed: '#{from} を #{to} に変更しました。', tagNameRequired: '#{name} の名前は空にできません。', selectOwner: '{owner} アカウントを選択してください。', selectRepository: '{repo} のみ選択してください。', createPat: '{name} 用PATを作成', allocateFailed: '新しいノート番号を取得できませんでした。{error}', moveToTrashConfirm: '「{title}」をゴミ箱に移動しますか？', restoreConfirm: '「{title}」を復元しますか？', attachmentLimit: '添付ファイルはノートごとに最大{count}件です。', attachmentLimitAdded: '上限により添付ファイルは{count}件まで追加されました。', fileTooLarge: '「{name}」は10MBを超えるためアップロードされませんでした。', deleteAttachmentConfirm: '「{name}」をリポジトリからも削除しますか？', deleteAttachment: '添付ファイル {name} を削除', uploading: 'アップロード中（{count}）', removeTag: 'タグ {name} を削除', openLink: '{url} を新しいタブで開く' },
  de: { noteCount: '{count} Notizen', openNote: 'Notiz {title} öffnen', clearFilter: 'Filter {label} entfernen', tagName: 'Tag-Name {name}', createTag: '#{name} erstellen', tagAdded: '#{name} hinzugefügt.', tagDeleted: '#{name} gelöscht.', tagRenamed: '#{from} in #{to} umbenannt.', tagNameRequired: 'Der Name von #{name} darf nicht leer sein.', selectOwner: 'Wählen Sie das Konto {owner}.', selectRepository: 'Wählen Sie nur {repo}.', createPat: 'PAT für {name} erstellen', allocateFailed: 'Keine Nummer für die neue Notiz verfügbar. {error}', moveToTrashConfirm: '„{title}“ in den Papierkorb verschieben?', restoreConfirm: '„{title}“ wiederherstellen?', attachmentLimit: 'Pro Notiz sind höchstens {count} Anhänge möglich.', attachmentLimitAdded: 'Wegen des Limits wurden nur {count} Anhänge hinzugefügt.', fileTooLarge: '„{name}“ wurde nicht hochgeladen, da die Datei größer als 10 MB ist.', deleteAttachmentConfirm: '„{name}“ auch aus dem Repository löschen?', deleteAttachment: 'Anhang {name} löschen', uploading: 'Wird hochgeladen ({count})', removeTag: 'Tag {name} entfernen', openLink: '{url} in neuem Tab öffnen' },
  fr: { noteCount: '{count} notes', openNote: 'Ouvrir la note {title}', clearFilter: 'Effacer le filtre {label}', tagName: 'Nom du tag {name}', createTag: 'Créer #{name}', tagAdded: '#{name} ajouté.', tagDeleted: '#{name} supprimé.', tagRenamed: '#{from} renommé en #{to}.', tagNameRequired: 'Le nom de #{name} ne peut pas être vide.', selectOwner: 'Sélectionnez le compte {owner}.', selectRepository: 'Sélectionnez uniquement {repo}.', createPat: 'Créer un PAT pour {name}', allocateFailed: 'Impossible d’attribuer un numéro à la nouvelle note. {error}', moveToTrashConfirm: 'Déplacer « {title} » dans la corbeille ?', restoreConfirm: 'Restaurer « {title} » ?', attachmentLimit: 'Chaque note peut contenir au maximum {count} pièces jointes.', attachmentLimitAdded: 'Seules {count} pièces jointes ont été ajoutées en raison de la limite.', fileTooLarge: '« {name} » dépasse 10 Mo et n’a pas été téléversé.', deleteAttachmentConfirm: 'Supprimer aussi « {name} » du dépôt ?', deleteAttachment: 'Supprimer la pièce jointe {name}', uploading: 'Téléversement ({count})', removeTag: 'Retirer le tag {name}', openLink: 'Ouvrir {url} dans un nouvel onglet' },
  it: { noteCount: '{count} note', openNote: 'Apri la nota {title}', clearFilter: 'Rimuovi il filtro {label}', tagName: 'Nome del tag {name}', createTag: 'Crea #{name}', tagAdded: '#{name} aggiunto.', tagDeleted: '#{name} eliminato.', tagRenamed: '#{from} rinominato in #{to}.', tagNameRequired: 'Il nome di #{name} non può essere vuoto.', selectOwner: 'Seleziona l’account {owner}.', selectRepository: 'Seleziona solo {repo}.', createPat: 'Crea un PAT per {name}', allocateFailed: 'Impossibile assegnare un numero alla nuova nota. {error}', moveToTrashConfirm: 'Spostare “{title}” nel cestino?', restoreConfirm: 'Ripristinare “{title}”?', attachmentLimit: 'Ogni nota può contenere al massimo {count} allegati.', attachmentLimitAdded: 'Sono stati aggiunti solo {count} allegati a causa del limite.', fileTooLarge: '“{name}” supera 10 MB e non è stato caricato.', deleteAttachmentConfirm: 'Eliminare “{name}” anche dal repository?', deleteAttachment: 'Elimina allegato {name}', uploading: 'Caricamento ({count})', removeTag: 'Rimuovi tag {name}', openLink: 'Apri {url} in una nuova scheda' }
};

function dynamicFor(code) {
  return { ...dynamic.en, ...(dynamicOverrides[code] || {}) };
}

function catalogWithOverrides(overrides = {}) {
  const messages = structuredClone(en);
  const ids = new Map(Object.entries(en.m).map(([id, text]) => [text, id]));
  for (const [english, translation] of Object.entries(overrides)) {
    const id = ids.get(english);
    if (id) messages.m[id] = translation;
  }
  return messages;
}

const errors = {
  en: { githubRequest: 'GitHub request failed.', repositoryFormat: 'Enter the repository as owner/repository.', issueNumberRequired: 'An issue number is required before attaching files.', attachmentLoad: 'Could not load the attachment.' },
  ko: { githubRequest: 'GitHub 요청에 실패했습니다.', repositoryFormat: '저장소를 owner/repository 형식으로 입력해주세요.', issueNumberRequired: '첨부하기 전에 이슈 번호가 필요합니다.', attachmentLoad: '첨부 파일을 불러오지 못했습니다.' }
};
const meta = {
  en: { description: 'Simple notes, kept as GitHub Issues', sourceCode: 'View source code on GitHub' },
  ko: { description: 'GitHub Issues에 그대로 보관되는 심플한 노트', sourceCode: 'GitHub에서 소스 코드 보기' },
  'zh-CN': { description: '简洁的笔记，直接保存为 GitHub Issues', sourceCode: '在 GitHub 上查看源代码' },
  ja: { description: 'シンプルなノートを、GitHub Issuesにそのまま保存', sourceCode: 'GitHubでソースコードを見る' },
  de: { description: 'Einfache Notizen, gespeichert als GitHub Issues', sourceCode: 'Quellcode auf GitHub ansehen' },
  fr: { description: 'Des notes simples, conservées sous forme d’issues GitHub', sourceCode: 'Voir le code source sur GitHub' },
  it: { description: 'Note semplici, conservate come issue di GitHub', sourceCode: 'Visualizza il codice sorgente su GitHub' }
};
const settings = {
  en: { language: 'Language', sidebarLabel: 'Settings', patReplacementPlaceholder: 'Enter only to replace the saved PAT', backgroundRefreshInterval: 'Check for new notes', refreshDisabled: 'Off', minutes: 'minutes', hours: 'hours', lockSessionDuration: 'Keep the lock number for', lockSessionHelp: 'How long an entered lock number stays reusable in this browser before locked notes ask for it again.' },
  ko: { language: '언어', sidebarLabel: '설정', patReplacementPlaceholder: '저장된 PAT를 변경할 때만 입력하세요', backgroundRefreshInterval: '새 노트 확인 주기', refreshDisabled: '사용 안 함', minutes: '분', hours: '시간', lockSessionDuration: '잠금 숫자 유지 시간', lockSessionHelp: '한 번 입력한 잠금 숫자를 이 브라우저에서 얼마나 재사용할지 정합니다. 시간이 지나면 잠금 노트가 숫자를 다시 묻습니다.' },
  'zh-CN': { language: '语言', sidebarLabel: '设置', patReplacementPlaceholder: '仅在更改已保存的 PAT 时输入', backgroundRefreshInterval: '检查新笔记', refreshDisabled: '关闭', minutes: '分钟', hours: '小时', lockSessionDuration: '锁定数字保留时间', lockSessionHelp: '设置已输入的锁定数字在本浏览器中可重复使用的时长。超时后，锁定笔记会再次要求输入。' },
  ja: { language: '言語', sidebarLabel: '設定', patReplacementPlaceholder: '保存済みのPATを変更する場合のみ入力', backgroundRefreshInterval: '新しいノートの確認間隔', refreshDisabled: 'オフ', minutes: '分', hours: '時間', lockSessionDuration: 'ロック番号の保持時間', lockSessionHelp: '一度入力したロック番号をこのブラウザで再利用できる時間です。経過するとロックされたノートで再入力を求められます。' },
  de: { language: 'Sprache', sidebarLabel: 'Einstellungen', patReplacementPlaceholder: 'Nur zum Ändern des gespeicherten PAT eingeben', backgroundRefreshInterval: 'Nach neuen Notizen suchen', refreshDisabled: 'Aus', minutes: 'Minuten', hours: 'Stunden', lockSessionDuration: 'Sperrzahl behalten für', lockSessionHelp: 'Wie lange eine eingegebene Sperrzahl in diesem Browser wiederverwendbar bleibt, bevor gesperrte Notizen erneut danach fragen.' },
  fr: { language: 'Langue', sidebarLabel: 'Paramètres', patReplacementPlaceholder: 'Saisir uniquement pour remplacer le PAT enregistré', backgroundRefreshInterval: 'Rechercher de nouvelles notes', refreshDisabled: 'Désactivé', minutes: 'minutes', hours: 'heures', lockSessionDuration: 'Conserver le code de verrouillage pendant', lockSessionHelp: 'Durée pendant laquelle un code de verrouillage saisi reste réutilisable dans ce navigateur avant que les notes verrouillées le redemandent.' },
  it: { language: 'Lingua', sidebarLabel: 'Impostazioni', patReplacementPlaceholder: 'Inserisci solo per sostituire il PAT salvato', backgroundRefreshInterval: 'Controlla nuove note', refreshDisabled: 'Disattivato', minutes: 'minuti', hours: 'ore', lockSessionDuration: 'Conserva il codice di blocco per', lockSessionHelp: 'Per quanto tempo un codice di blocco inserito resta riutilizzabile in questo browser prima che le note bloccate lo richiedano di nuovo.' }
};
const setup = {
  en: {
    confirmPatStorage: 'Save this PAT in this browser?\n\nIf you save it, the app can reconnect without asking for the PAT every time. Anyone who can use this browser profile may be able to use the PAT, so never enable this option on a shared or public device.\n\nIs this your personal device, and do you want to continue? Select Cancel to leave everything unchanged. You can then clear the checkbox and connect without saving the PAT.',
    wizardTitle: 'Set up Ginote', stepCount: 'Step {step} of {total}', progressLabel: 'Setup progress',
    introTitle: 'Keep personal notes in your own GitHub repository', introDescription: 'Ginote turns GitHub Issues into a simple notes app. Your notes go directly between this browser and GitHub without passing through an app server.',
    introFeatureStorage: 'Each note is stored as a GitHub Issue.', introFeatureTags: 'Labels become tags, and closed issues become trash.', introFeaturePrivacy: 'A private repository keeps your personal notes from being public.',
    accountTitle: 'First, prepare a GitHub account', accountDescription: 'You need a GitHub account to create and store notes. GitHub accounts are free to create. If you do not have one yet, create it from the link below.', createAccount: 'Create a GitHub account',
    repositoryTitle: 'Create a private notes repository', repositoryDescription: 'Create a new repository on GitHub and make sure its visibility is Private. Then paste its address below.', createRepository: 'Create a private repository on GitHub', repositoryAddress: 'Repository address', repositoryAddressHelp: 'You can enter a GitHub URL or owner/repository.',
    patTitle: 'Create and enter a PAT', patDescription: 'Ginote needs a fine-grained personal access token to read and write notes in this repository.', createPat: 'Create a PAT for this repository', patHelp: 'Allow Issues read/write access. Also allow Contents read/write access to use attachments.', rememberPat: 'Remember PAT in this browser',
    previous: 'Back', start: 'Start setup', haveAccount: 'I have an account', repositoryDone: 'Repository address entered', finish: 'Complete setup', connecting: 'Connecting…'
  },
  ko: {
    confirmPatStorage: '이 브라우저에 PAT를 저장할까요?\n\n저장하면 다음부터 PAT를 다시 입력하지 않아도 바로 연결할 수 있습니다. 다만 이 브라우저 프로필에 접근할 수 있는 사람은 PAT를 사용할 수 있으므로, 공용 또는 공유 디바이스에서는 절대로 이 옵션을 켜면 안 됩니다.\n\n이 디바이스는 개인용이며 계속 진행할까요? 취소를 누르면 아무것도 변경하거나 연결하지 않습니다. 체크를 해제한 뒤 PAT를 저장하지 않고 연결할 수 있습니다.',
    wizardTitle: 'Ginote 설정', stepCount: '{total}단계 중 {step}단계', progressLabel: '설정 진행 상황',
    introTitle: '내 GitHub 저장소를 개인 노트 공간으로', introDescription: 'Ginote는 GitHub Issues를 간편한 노트 앱으로 바꿔줍니다. 노트는 별도 앱 서버를 거치지 않고 이 브라우저와 GitHub 사이에서 직접 오갑니다.',
    introFeatureStorage: '노트 하나가 GitHub Issue 하나로 저장됩니다.', introFeatureTags: '라벨은 태그로, 닫힌 이슈는 휴지통으로 사용합니다.', introFeaturePrivacy: '비공개 저장소를 사용해 개인 노트가 공개되지 않게 합니다.',
    accountTitle: '먼저 GitHub 계정을 준비하세요', accountDescription: '노트를 만들고 저장하려면 GitHub 계정이 필요합니다. GitHub 계정은 무료로 만들 수 있습니다. 아직 계정이 없다면 아래 링크에서 먼저 만들어주세요.', createAccount: 'GitHub 계정 만들기',
    repositoryTitle: '비공개 노트 저장소를 만드세요', repositoryDescription: 'GitHub에서 새 저장소를 만들고 공개 범위를 반드시 Private으로 설정하세요. 만든 뒤 저장소 주소를 아래에 붙여 넣습니다.', createRepository: 'GitHub에서 비공개 저장소 만들기', repositoryAddress: '저장소 주소', repositoryAddressHelp: 'GitHub 주소 또는 owner/repository 형식으로 입력할 수 있습니다.',
    patTitle: 'PAT를 발급하고 입력하세요', patDescription: 'Ginote가 이 저장소의 노트를 읽고 쓰려면 Fine-grained personal access token이 필요합니다.', createPat: '이 저장소용 PAT 발급하기', patHelp: 'Issues 읽기·쓰기를 허용하세요. 첨부파일을 사용하려면 Contents 읽기·쓰기도 허용해야 합니다.', rememberPat: '이 브라우저에 PAT 기억하기',
    previous: '이전', start: '설정 시작', haveAccount: '계정이 있습니다', repositoryDone: '주소 입력 완료', finish: '설정 완료', connecting: '연결 중…'
  },
  'zh-CN': {
    confirmPatStorage: '要将此 PAT 保存在本浏览器中吗？\n\n保存后，应用下次可以直接重新连接，无需再次输入 PAT。任何能使用此浏览器配置文件的人都可能使用该 PAT，因此请勿在公用或共享设备上启用此选项。\n\n这是您的个人设备，并且要继续吗？选择“取消”不会更改任何内容，也不会连接。之后您可以取消勾选，并在不保存 PAT 的情况下连接。',
    wizardTitle: '设置 Ginote', stepCount: '第 {step} 步，共 {total} 步', progressLabel: '设置进度',
    introTitle: '将自己的 GitHub 仓库变成个人笔记空间', introDescription: 'Ginote 将 GitHub Issues 变成简洁的笔记应用。笔记只在本浏览器与 GitHub 之间直接传输，不经过应用服务器。',
    introFeatureStorage: '每条笔记都保存为一个 GitHub Issue。', introFeatureTags: '标签用作分类标签，已关闭的 Issue 用作回收站。', introFeaturePrivacy: '使用私有仓库，避免个人笔记被公开。',
    accountTitle: '首先，准备一个 GitHub 账户', accountDescription: '创建和保存笔记需要 GitHub 账户。GitHub 账户可以免费注册。如果您还没有账户，请通过下方链接创建。', createAccount: '创建 GitHub 账户',
    repositoryTitle: '创建私有笔记仓库', repositoryDescription: '在 GitHub 上新建仓库，并务必将可见性设为 Private。然后将仓库地址粘贴到下方。', createRepository: '在 GitHub 上创建私有仓库', repositoryAddress: '仓库地址', repositoryAddressHelp: '可以输入 GitHub URL 或 owner/repository。',
    patTitle: '创建并输入 PAT', patDescription: 'Ginote 需要 fine-grained personal access token，才能读写此仓库中的笔记。', createPat: '为此仓库创建 PAT', patHelp: '请允许 Issues 读取和写入权限。如需使用附件，还要允许 Contents 读取和写入权限。', rememberPat: '在本浏览器中记住 PAT',
    previous: '上一步', start: '开始设置', haveAccount: '我已有账户', repositoryDone: '仓库地址已输入', finish: '完成设置', connecting: '正在连接…'
  },
  ja: {
    confirmPatStorage: 'このPATをブラウザに保存しますか？\n\n保存すると、次回からPATを入力せずに再接続できます。このブラウザプロファイルを利用できる人はPATを使用できる可能性があるため、共用端末や公共の端末では絶対に有効にしないでください。\n\nこの端末は個人用で、このまま続けますか？「キャンセル」を選ぶと、変更や接続は行われません。その後、チェックを外せばPATを保存せずに接続できます。',
    wizardTitle: 'Ginoteのセットアップ', stepCount: '{total}ステップ中{step}ステップ', progressLabel: 'セットアップの進行状況',
    introTitle: '自分のGitHubリポジトリを個人用ノートに', introDescription: 'GinoteはGitHub Issuesをシンプルなノートアプリとして使えるようにします。ノートはアプリサーバーを経由せず、このブラウザとGitHubの間で直接やり取りされます。',
    introFeatureStorage: '1件のノートが1件のGitHub Issueとして保存されます。', introFeatureTags: 'ラベルはタグ、クローズしたIssueはゴミ箱として使います。', introFeaturePrivacy: '非公開リポジトリを使い、個人のノートが公開されないようにします。',
    accountTitle: 'まずGitHubアカウントを用意してください', accountDescription: 'ノートの作成と保存にはGitHubアカウントが必要です。GitHubアカウントは無料で作成できます。まだお持ちでない場合は、下のリンクから作成してください。', createAccount: 'GitHubアカウントを作成',
    repositoryTitle: '非公開のノート用リポジトリを作成してください', repositoryDescription: 'GitHubで新しいリポジトリを作成し、公開範囲を必ずPrivateに設定してください。作成後、リポジトリのアドレスを下に貼り付けます。', createRepository: 'GitHubで非公開リポジトリを作成', repositoryAddress: 'リポジトリのアドレス', repositoryAddressHelp: 'GitHub URLまたはowner/repository形式で入力できます。',
    patTitle: 'PATを発行して入力してください', patDescription: 'Ginoteがこのリポジトリのノートを読み書きするには、Fine-grained personal access tokenが必要です。', createPat: 'このリポジトリ用のPATを発行', patHelp: 'Issuesの読み取り・書き込みを許可してください。添付ファイルを使う場合は、Contentsの読み取り・書き込みも許可します。', rememberPat: 'このブラウザにPATを保存する',
    previous: '戻る', start: 'セットアップを開始', haveAccount: 'アカウントを持っています', repositoryDone: 'アドレス入力完了', finish: 'セットアップ完了', connecting: '接続中…'
  },
  de: {
    confirmPatStorage: 'Dieses PAT in diesem Browser speichern?\n\nWenn Sie es speichern, kann die App künftig ohne erneute PAT-Eingabe eine Verbindung herstellen. Jeder, der dieses Browserprofil verwenden kann, könnte auch das PAT nutzen. Aktivieren Sie diese Option daher niemals auf einem öffentlichen oder gemeinsam genutzten Gerät.\n\nIst dies Ihr persönliches Gerät und möchten Sie fortfahren? Mit „Abbrechen“ bleibt alles unverändert und es wird keine Verbindung hergestellt. Sie können dann das Häkchen entfernen und eine Verbindung herstellen, ohne das PAT zu speichern.',
    wizardTitle: 'Ginote einrichten', stepCount: 'Schritt {step} von {total}', progressLabel: 'Einrichtungsfortschritt',
    introTitle: 'Persönliche Notizen im eigenen GitHub-Repository', introDescription: 'Ginote macht aus GitHub Issues eine einfache Notiz-App. Ihre Notizen werden direkt zwischen diesem Browser und GitHub übertragen, ohne einen App-Server zu durchlaufen.',
    introFeatureStorage: 'Jede Notiz wird als GitHub Issue gespeichert.', introFeatureTags: 'Labels werden zu Tags und geschlossene Issues zum Papierkorb.', introFeaturePrivacy: 'Ein privates Repository verhindert, dass persönliche Notizen öffentlich werden.',
    accountTitle: 'Bereiten Sie zuerst ein GitHub-Konto vor', accountDescription: 'Zum Erstellen und Speichern von Notizen benötigen Sie ein GitHub-Konto. Ein GitHub-Konto kann kostenlos erstellt werden. Falls Sie noch keines haben, erstellen Sie es über den folgenden Link.', createAccount: 'GitHub-Konto erstellen',
    repositoryTitle: 'Privates Notiz-Repository erstellen', repositoryDescription: 'Erstellen Sie ein neues Repository auf GitHub und setzen Sie die Sichtbarkeit unbedingt auf Private. Fügen Sie anschließend die Repository-Adresse unten ein.', createRepository: 'Privates Repository auf GitHub erstellen', repositoryAddress: 'Repository-Adresse', repositoryAddressHelp: 'Sie können eine GitHub-URL oder owner/repository eingeben.',
    patTitle: 'PAT erstellen und eingeben', patDescription: 'Ginote benötigt ein Fine-grained Personal Access Token, um Notizen in diesem Repository zu lesen und zu schreiben.', createPat: 'PAT für dieses Repository erstellen', patHelp: 'Erlauben Sie Lese- und Schreibzugriff auf Issues. Für Anhänge ist zusätzlich Lese- und Schreibzugriff auf Contents erforderlich.', rememberPat: 'PAT in diesem Browser speichern',
    previous: 'Zurück', start: 'Einrichtung starten', haveAccount: 'Ich habe ein Konto', repositoryDone: 'Adresse eingegeben', finish: 'Einrichtung abschließen', connecting: 'Verbindung wird hergestellt…'
  },
  fr: {
    confirmPatStorage: 'Enregistrer ce PAT dans ce navigateur ?\n\nS’il est enregistré, l’application pourra se reconnecter sans vous le redemander. Toute personne ayant accès à ce profil de navigateur pourrait utiliser le PAT. N’activez donc jamais cette option sur un appareil public ou partagé.\n\nS’agit-il de votre appareil personnel et souhaitez-vous continuer ? « Annuler » ne modifiera rien et n’établira aucune connexion. Vous pourrez ensuite décocher la case et vous connecter sans enregistrer le PAT.',
    wizardTitle: 'Configurer Ginote', stepCount: 'Étape {step} sur {total}', progressLabel: 'Progression de la configuration',
    introTitle: 'Conservez vos notes personnelles dans votre propre dépôt GitHub', introDescription: 'Ginote transforme GitHub Issues en une application de notes simple. Vos notes transitent directement entre ce navigateur et GitHub, sans passer par un serveur d’application.',
    introFeatureStorage: 'Chaque note est enregistrée sous forme de GitHub Issue.', introFeatureTags: 'Les labels deviennent des tags et les issues fermées servent de corbeille.', introFeaturePrivacy: 'Un dépôt privé empêche que vos notes personnelles soient publiques.',
    accountTitle: 'Commencez par préparer un compte GitHub', accountDescription: 'Un compte GitHub est nécessaire pour créer et enregistrer des notes. La création d’un compte GitHub est gratuite. Si vous n’en avez pas encore, créez-en un depuis le lien ci-dessous.', createAccount: 'Créer un compte GitHub',
    repositoryTitle: 'Créez un dépôt privé pour vos notes', repositoryDescription: 'Créez un dépôt sur GitHub et veillez à définir sa visibilité sur Private. Collez ensuite son adresse ci-dessous.', createRepository: 'Créer un dépôt privé sur GitHub', repositoryAddress: 'Adresse du dépôt', repositoryAddressHelp: 'Vous pouvez saisir une URL GitHub ou owner/repository.',
    patTitle: 'Créez et saisissez un PAT', patDescription: 'Ginote a besoin d’un fine-grained personal access token pour lire et écrire les notes de ce dépôt.', createPat: 'Créer un PAT pour ce dépôt', patHelp: 'Autorisez l’accès en lecture et écriture à Issues. Pour utiliser les pièces jointes, autorisez également l’accès en lecture et écriture à Contents.', rememberPat: 'Mémoriser le PAT dans ce navigateur',
    previous: 'Retour', start: 'Commencer la configuration', haveAccount: 'J’ai un compte', repositoryDone: 'Adresse saisie', finish: 'Terminer la configuration', connecting: 'Connexion…'
  },
  it: {
    confirmPatStorage: 'Salvare questo PAT nel browser?\n\nSalvandolo, l’app potrà riconnettersi senza richiederlo ogni volta. Chiunque possa usare questo profilo del browser potrebbe utilizzare il PAT, quindi non attivare mai questa opzione su un dispositivo pubblico o condiviso.\n\nQuesto è il tuo dispositivo personale e vuoi continuare? Selezionando “Annulla” non verrà modificato nulla e non verrà stabilita alcuna connessione. Potrai quindi deselezionare la casella e connetterti senza salvare il PAT.',
    wizardTitle: 'Configura Ginote', stepCount: 'Passaggio {step} di {total}', progressLabel: 'Avanzamento della configurazione',
    introTitle: 'Conserva le note personali nel tuo repository GitHub', introDescription: 'Ginote trasforma GitHub Issues in una semplice app per appunti. Le note passano direttamente tra questo browser e GitHub, senza attraversare un server dell’app.',
    introFeatureStorage: 'Ogni nota viene salvata come GitHub Issue.', introFeatureTags: 'Le etichette diventano tag e le issue chiuse diventano il cestino.', introFeaturePrivacy: 'Un repository privato impedisce che le note personali siano pubbliche.',
    accountTitle: 'Per prima cosa, prepara un account GitHub', accountDescription: 'Per creare e salvare le note è necessario un account GitHub. La creazione di un account GitHub è gratuita. Se non ne hai ancora uno, crealo dal link qui sotto.', createAccount: 'Crea un account GitHub',
    repositoryTitle: 'Crea un repository privato per le note', repositoryDescription: 'Crea un nuovo repository su GitHub e assicurati di impostarne la visibilità su Private. Quindi incolla qui sotto il suo indirizzo.', createRepository: 'Crea un repository privato su GitHub', repositoryAddress: 'Indirizzo del repository', repositoryAddressHelp: 'Puoi inserire un URL GitHub oppure owner/repository.',
    patTitle: 'Crea e inserisci un PAT', patDescription: 'Ginote richiede un fine-grained personal access token per leggere e scrivere le note in questo repository.', createPat: 'Crea un PAT per questo repository', patHelp: 'Consenti l’accesso in lettura e scrittura a Issues. Per usare gli allegati, consenti anche l’accesso in lettura e scrittura a Contents.', rememberPat: 'Ricorda il PAT in questo browser',
    previous: 'Indietro', start: 'Avvia configurazione', haveAccount: 'Ho un account', repositoryDone: 'Indirizzo inserito', finish: 'Completa configurazione', connecting: 'Connessione…'
  }
};

addMessages('en', { ...en, dynamic: dynamic.en, errors: errors.en, meta: meta.en, settings: settings.en, setup: setup.en });
addMessages('ko', { ...ko, dynamic: dynamic.ko, errors: errors.ko, meta: meta.ko, settings: settings.ko, setup: setup.ko });
addMessages('zh-CN', { ...zh, dynamic: dynamicFor('zh-CN'), errors: errors.en, meta: meta['zh-CN'], settings: settings['zh-CN'], setup: setup['zh-CN'] });
for (const code of ['ja', 'de', 'fr', 'it']) {
  addMessages(code, { ...catalogWithOverrides(common[code]), dynamic: dynamicFor(code), errors: errors.en, meta: meta[code], settings: settings[code], setup: setup[code] });
}

export function normalizeLocale(value) {
  const language = String(value || '').toLowerCase();
  if (language.startsWith('ko')) return 'ko';
  if (language.startsWith('zh')) return 'zh-CN';
  if (language.startsWith('ja')) return 'ja';
  if (language.startsWith('de')) return 'de';
  if (language.startsWith('fr')) return 'fr';
  if (language.startsWith('it')) return 'it';
  return 'en';
}

export function setAppLocale(preference = 'auto') {
  const resolved = preference === 'auto' ? normalizeLocale(globalThis.navigator?.language) : normalizeLocale(preference);
  locale.set(resolved);
  globalThis.document?.documentElement?.setAttribute('lang', resolved);
  globalThis.document?.querySelector('meta[name="description"]')?.setAttribute(
    'content', (meta[resolved] || meta.en).description
  );
  return resolved;
}

export function translate(key, values) {
  return get(_)(key, values ? { values } : undefined);
}

init({ fallbackLocale: 'en', initialLocale: normalizeLocale(globalThis.navigator?.language) });
