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
  ja: { Add: '追加', Attach: '添付', 'Back to list': '一覧に戻る', Clear: 'クリア', Close: '閉じる', Copy: 'コピー', Delete: '削除', Download: 'ダウンロード', 'Editor settings': 'エディター設定', Font: 'フォント', List: '一覧', 'Load more': 'さらに読み込む', 'Loading notes…': 'ノートを読み込み中…', 'Manage tags': 'タグ管理', 'New note': '新しいノート', 'New tag name': '新しいタグ名', Notes: 'ノート', 'Notes per page': '1ページのノート数', Refresh: '更新', Restore: '復元', Saved: '保存済み', 'Saving...': '保存中...', Search: '検索', Settings: '設定', Tags: 'タグ', Trash: 'ゴミ箱', 'Auto-save delay': '自動保存までの時間', 'Line height': '行間', Size: 'サイズ', 'Title mode': 'タイトル方式', 'Write your note…': 'ノートを入力…', 'Select a note from the list.': '左の一覧からノートを選択してください。', 'No notes yet.': 'ノートはまだありません。', 'No results found.': '検索結果がありません。', 'Search or #tag': '検索または #タグ', 'Connect and start': '接続して開始', 'Connect a GitHub repository': 'GitHubリポジトリに接続', 'Remember PAT in this browser': 'このブラウザにPATを保存', 'Notes repository': 'ノート用リポジトリ' , sec: '秒' , 'Changed.': '変更しました。' },
  de: { Add: 'Hinzufügen', Attach: 'Anhängen', 'Back to list': 'Zurück zur Liste', Clear: 'Leeren', Close: 'Schließen', Copy: 'Kopieren', Delete: 'Löschen', Download: 'Herunterladen', 'Editor settings': 'Editor-Einstellungen', Font: 'Schriftart', List: 'Liste', 'Load more': 'Mehr laden', 'Loading notes…': 'Notizen werden geladen…', 'Manage tags': 'Tags verwalten', 'New note': 'Neue Notiz', 'New tag name': 'Neuer Tag-Name', Notes: 'Notizen', 'Notes per page': 'Notizen pro Seite', Refresh: 'Aktualisieren', Restore: 'Wiederherstellen', Saved: 'Gespeichert', 'Saving...': 'Wird gespeichert...', Search: 'Suchen', Settings: 'Einstellungen', Tags: 'Tags', Trash: 'Papierkorb', 'Auto-save delay': 'Verzögerung der automatischen Speicherung', 'Line height': 'Zeilenhöhe', Size: 'Größe', 'Title mode': 'Titelmodus', 'Write your note…': 'Notiz schreiben…', 'Select a note from the list.': 'Wählen Sie links eine Notiz aus.', 'No notes yet.': 'Noch keine Notizen.', 'No results found.': 'Keine Ergebnisse gefunden.', 'Search or #tag': 'Suchen oder #Tag', 'Connect and start': 'Verbinden und starten', 'Connect a GitHub repository': 'GitHub-Repository verbinden', 'Remember PAT in this browser': 'PAT in diesem Browser speichern', 'Notes repository': 'Notiz-Repository' , sec: 'Sek.' , 'Changed.': 'Geändert.' },
  fr: { Add: 'Ajouter', Attach: 'Joindre', 'Back to list': 'Retour à la liste', Clear: 'Effacer', Close: 'Fermer', Copy: 'Copier', Delete: 'Supprimer', Download: 'Télécharger', 'Editor settings': 'Paramètres de l’éditeur', Font: 'Police', List: 'Liste', 'Load more': 'Charger plus', 'Loading notes…': 'Chargement des notes…', 'Manage tags': 'Gérer les tags', 'New note': 'Nouvelle note', 'New tag name': 'Nouveau tag', Notes: 'Notes', 'Notes per page': 'Notes par page', Refresh: 'Actualiser', Restore: 'Restaurer', Saved: 'Enregistré', 'Saving...': 'Enregistrement...', Search: 'Rechercher', Settings: 'Paramètres', Tags: 'Tags', Trash: 'Corbeille', 'Auto-save delay': 'Délai d’enregistrement automatique', 'Line height': 'Interligne', Size: 'Taille', 'Title mode': 'Mode de titre', 'Write your note…': 'Écrivez votre note…', 'Select a note from the list.': 'Sélectionnez une note dans la liste.', 'No notes yet.': 'Aucune note pour le moment.', 'No results found.': 'Aucun résultat.', 'Search or #tag': 'Rechercher ou #tag', 'Connect and start': 'Connecter et commencer', 'Connect a GitHub repository': 'Connecter un dépôt GitHub', 'Remember PAT in this browser': 'Mémoriser le PAT dans ce navigateur', 'Notes repository': 'Dépôt des notes' , sec: 's' , 'Changed.': 'Modifié.' },
  it: { Add: 'Aggiungi', Attach: 'Allega', 'Back to list': 'Torna alla lista', Clear: 'Cancella', Close: 'Chiudi', Copy: 'Copia', Delete: 'Elimina', Download: 'Scarica', 'Editor settings': 'Impostazioni dell’editor', Font: 'Carattere', List: 'Elenco', 'Load more': 'Carica altro', 'Loading notes…': 'Caricamento note…', 'Manage tags': 'Gestisci tag', 'New note': 'Nuova nota', 'New tag name': 'Nuovo tag', Notes: 'Note', 'Notes per page': 'Note per pagina', Refresh: 'Aggiorna', Restore: 'Ripristina', Saved: 'Salvato', 'Saving...': 'Salvataggio...', Search: 'Cerca', Settings: 'Impostazioni', Tags: 'Tag', Trash: 'Cestino', 'Auto-save delay': 'Ritardo salvataggio automatico', 'Line height': 'Interlinea', Size: 'Dimensione', 'Title mode': 'Modalità titolo', 'Write your note…': 'Scrivi la nota…', 'Select a note from the list.': 'Seleziona una nota dalla lista.', 'No notes yet.': 'Nessuna nota.', 'No results found.': 'Nessun risultato.', 'Search or #tag': 'Cerca o #tag', 'Connect and start': 'Connetti e inizia', 'Connect a GitHub repository': 'Connetti un repository GitHub', 'Remember PAT in this browser': 'Ricorda il PAT in questo browser', 'Notes repository': 'Repository delle note' , sec: 'sec' , 'Changed.': 'Modificato.' }
};

const dynamic = {
  en: { noteCount: '{count} notes', openNote: 'Open note {title}', clearFilter: 'Clear {label} filter', tagName: '{name} tag name', createTag: 'Create #{name}', tagAdded: 'Added #{name}.', tagDeleted: 'Deleted #{name}.', deleteTagConfirm: 'Delete the #{name} tag from every note?', tagRenamed: 'Renamed #{from} to #{to}.', tagNameRequired: 'The name of #{name} cannot be empty.', selectOwner: 'Select the {owner} account.', selectRepository: 'Select only {repo}.', createPat: 'Create a PAT for {name}', allocateFailed: 'Could not allocate a number for the new note. {error}', moveToTrashConfirm: 'Move “{title}” to trash?', restoreConfirm: 'Restore “{title}”?', closedIssueSaveConfirm: '“{title}” was moved to trash on another device. Restore it and save your changes?', attachmentLimit: 'Each note can have up to {count} attachments.', attachmentLimitAdded: 'Only {count} attachments were added because that is the per-note limit.', fileTooLarge: '“{name}” was not uploaded because it exceeds 10 MB.', deleteAttachmentConfirm: 'Delete “{name}” from the repository too?', deleteAttachment: 'Delete attachment {name}', uploading: 'Uploading ({count})', removeTag: 'Remove tag {name}', openLink: 'Open {url} in a new tab', pasteLocationRequired: 'Place the cursor where you want to paste first.', createdAt: 'Created: {date}', updatedAt: 'Updated: {date}', viewOnGitHub: 'View on GitHub', workspaceDisplayNameLabel: 'Display name for {repo}', mcpPrompt: 'Use GitHub Issues in {repo} as notes. Open issues are regular notes, closed issues are trash, and labels are tags. Each attachment is stored under .issue-note-assets/issues/{issueNumber}/ and referenced by a plain image or file link directly in the issue body. Preserve these links when editing a note\'s body — deleting one detaches that attachment.' },
  ko: { noteCount: '{count}개', openNote: '{title} 노트 열기', clearFilter: '{label} 필터 지우기', tagName: '{name} 태그 이름', createTag: '#{name} 태그 만들기', tagAdded: '#{name} 태그를 추가했습니다.', tagDeleted: '#{name} 태그를 삭제했습니다.', deleteTagConfirm: '#{name} 태그를 모든 노트에서 삭제할까요?', tagRenamed: '#{from} 태그 이름을 #{to}로 바꿨습니다.', tagNameRequired: '태그 이름을 입력하세요.', selectOwner: '{owner} 계정을 선택하세요.', selectRepository: '{repo} 저장소만 선택하세요.', createPat: '{name}용 PAT 만들기', allocateFailed: '새 노트를 준비하지 못했습니다. {error}', moveToTrashConfirm: '“{title}” 노트를 휴지통으로 옮길까요?', restoreConfirm: '“{title}” 노트를 복원할까요?', closedIssueSaveConfirm: '다른 기기에서 “{title}” 노트를 휴지통으로 옮겼습니다. 복원한 뒤 수정 내용을 저장할까요?', attachmentLimit: '노트당 첨부파일은 최대 {count}개까지 추가할 수 있습니다.', attachmentLimitAdded: '노트당 첨부파일은 최대 {count}개라서 {count}개만 추가했습니다.', fileTooLarge: '“{name}” 파일은 10MB보다 커서 업로드하지 않았습니다.', deleteAttachmentConfirm: '“{name}” 파일을 저장소에서도 삭제할까요?', deleteAttachment: '첨부파일 {name} 삭제', uploading: '업로드 중 ({count}개)', removeTag: '{name} 태그 제거', openLink: '{url} 새 탭으로 열기', pasteLocationRequired: '붙여넣을 위치를 먼저 클릭하세요.', createdAt: '생성됨: {date}', updatedAt: '수정됨: {date}', viewOnGitHub: 'GitHub에서 보기', workspaceDisplayNameLabel: '{repo} 표시 이름', mcpPrompt: '{repo} 저장소의 GitHub Issues를 노트로 사용하세요. 열린 이슈는 노트, 닫힌 이슈는 휴지통이며 GitHub 라벨은 태그입니다. 첨부파일은 .issue-note-assets/issues/{issueNumber}/ 폴더에 저장되고, 이슈 본문에 일반 이미지·파일 링크로 연결되어 있습니다. 노트 본문을 수정할 때 이 링크를 반드시 그대로 유지하세요. 링크를 지우면 해당 첨부파일 연결도 끊깁니다.' }
};

const dynamicOverrides = {
  'zh-CN': { noteCount: '{count} 条笔记', openNote: '打开笔记 {title}', clearFilter: '清除 {label} 筛选', tagName: '{name} 标签名称', createTag: '创建 #{name}', tagAdded: '已添加 #{name}。', tagDeleted: '已删除 #{name}。', deleteTagConfirm: '要从所有笔记中删除 #{name} 标签吗？', tagRenamed: '已将 #{from} 重命名为 #{to}。', tagNameRequired: '#{name} 的名称不能为空。', selectOwner: '请选择 {owner} 账户。', selectRepository: '仅选择 {repo}。', createPat: '为 {name} 创建 PAT', allocateFailed: '无法为新笔记分配编号。{error}', moveToTrashConfirm: '将“{title}”移至回收站？', restoreConfirm: '恢复“{title}”？', attachmentLimit: '每条笔记最多可有 {count} 个附件。', attachmentLimitAdded: '由于每条笔记的限制，仅添加了 {count} 个附件。', fileTooLarge: '“{name}”超过 10 MB，未上传。', deleteAttachmentConfirm: '也从仓库中删除“{name}”？', deleteAttachment: '删除附件 {name}', uploading: '上传中（{count}）', removeTag: '移除标签 {name}', openLink: '在新标签页中打开 {url}' },
  ja: { noteCount: '{count}件', openNote: 'ノート「{title}」を開く', clearFilter: '{label} フィルターを解除', tagName: '{name} のタグ名', createTag: '#{name} を作成', tagAdded: '#{name} を追加しました。', tagDeleted: '#{name} を削除しました。', deleteTagConfirm: 'すべてのノートから #{name} タグを削除しますか？', tagRenamed: '#{from} を #{to} に変更しました。', tagNameRequired: '#{name} の名前は空にできません。', selectOwner: '{owner} アカウントを選択してください。', selectRepository: '{repo} のみ選択してください。', createPat: '{name} 用PATを作成', allocateFailed: '新しいノート番号を取得できませんでした。{error}', moveToTrashConfirm: '「{title}」をゴミ箱に移動しますか？', restoreConfirm: '「{title}」を復元しますか？', attachmentLimit: '添付ファイルはノートごとに最大{count}件です。', attachmentLimitAdded: '上限により添付ファイルは{count}件まで追加されました。', fileTooLarge: '「{name}」は10MBを超えるためアップロードされませんでした。', deleteAttachmentConfirm: '「{name}」をリポジトリからも削除しますか？', deleteAttachment: '添付ファイル {name} を削除', uploading: 'アップロード中（{count}）', removeTag: 'タグ {name} を削除', openLink: '{url} を新しいタブで開く' },
  de: { noteCount: '{count} Notizen', openNote: 'Notiz {title} öffnen', clearFilter: 'Filter {label} entfernen', tagName: 'Tag-Name {name}', createTag: '#{name} erstellen', tagAdded: '#{name} hinzugefügt.', tagDeleted: '#{name} gelöscht.', deleteTagConfirm: 'Das Tag #{name} aus allen Notizen löschen?', tagRenamed: '#{from} in #{to} umbenannt.', tagNameRequired: 'Der Name von #{name} darf nicht leer sein.', selectOwner: 'Wählen Sie das Konto {owner}.', selectRepository: 'Wählen Sie nur {repo}.', createPat: 'PAT für {name} erstellen', allocateFailed: 'Keine Nummer für die neue Notiz verfügbar. {error}', moveToTrashConfirm: '„{title}“ in den Papierkorb verschieben?', restoreConfirm: '„{title}“ wiederherstellen?', attachmentLimit: 'Pro Notiz sind höchstens {count} Anhänge möglich.', attachmentLimitAdded: 'Wegen des Limits wurden nur {count} Anhänge hinzugefügt.', fileTooLarge: '„{name}“ wurde nicht hochgeladen, da die Datei größer als 10 MB ist.', deleteAttachmentConfirm: '„{name}“ auch aus dem Repository löschen?', deleteAttachment: 'Anhang {name} löschen', uploading: 'Wird hochgeladen ({count})', removeTag: 'Tag {name} entfernen', openLink: '{url} in neuem Tab öffnen' },
  fr: { noteCount: '{count} notes', openNote: 'Ouvrir la note {title}', clearFilter: 'Effacer le filtre {label}', tagName: 'Nom du tag {name}', createTag: 'Créer #{name}', tagAdded: '#{name} ajouté.', tagDeleted: '#{name} supprimé.', deleteTagConfirm: 'Supprimer le tag #{name} de toutes les notes ?', tagRenamed: '#{from} renommé en #{to}.', tagNameRequired: 'Le nom de #{name} ne peut pas être vide.', selectOwner: 'Sélectionnez le compte {owner}.', selectRepository: 'Sélectionnez uniquement {repo}.', createPat: 'Créer un PAT pour {name}', allocateFailed: 'Impossible d’attribuer un numéro à la nouvelle note. {error}', moveToTrashConfirm: 'Déplacer « {title} » dans la corbeille ?', restoreConfirm: 'Restaurer « {title} » ?', attachmentLimit: 'Chaque note peut contenir au maximum {count} pièces jointes.', attachmentLimitAdded: 'Seules {count} pièces jointes ont été ajoutées en raison de la limite.', fileTooLarge: '« {name} » dépasse 10 Mo et n’a pas été téléversé.', deleteAttachmentConfirm: 'Supprimer aussi « {name} » du dépôt ?', deleteAttachment: 'Supprimer la pièce jointe {name}', uploading: 'Téléversement ({count})', removeTag: 'Retirer le tag {name}', openLink: 'Ouvrir {url} dans un nouvel onglet' },
  it: { noteCount: '{count} note', openNote: 'Apri la nota {title}', clearFilter: 'Rimuovi il filtro {label}', tagName: 'Nome del tag {name}', createTag: 'Crea #{name}', tagAdded: '#{name} aggiunto.', tagDeleted: '#{name} eliminato.', deleteTagConfirm: 'Eliminare il tag #{name} da tutte le note?', tagRenamed: '#{from} rinominato in #{to}.', tagNameRequired: 'Il nome di #{name} non può essere vuoto.', selectOwner: 'Seleziona l’account {owner}.', selectRepository: 'Seleziona solo {repo}.', createPat: 'Crea un PAT per {name}', allocateFailed: 'Impossibile assegnare un numero alla nuova nota. {error}', moveToTrashConfirm: 'Spostare “{title}” nel cestino?', restoreConfirm: 'Ripristinare “{title}”?', attachmentLimit: 'Ogni nota può contenere al massimo {count} allegati.', attachmentLimitAdded: 'Sono stati aggiunti solo {count} allegati a causa del limite.', fileTooLarge: '“{name}” supera 10 MB e non è stato caricato.', deleteAttachmentConfirm: 'Eliminare “{name}” anche dal repository?', deleteAttachment: 'Elimina allegato {name}', uploading: 'Caricamento ({count})', removeTag: 'Rimuovi tag {name}', openLink: 'Apri {url} in una nuova scheda' }
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
  ko: { githubRequest: 'GitHub에 요청을 보내지 못했습니다.', repositoryFormat: '저장소 주소를 owner/repository 형식으로 입력하세요.', issueNumberRequired: '파일을 첨부하려면 먼저 노트를 저장하세요.', attachmentLoad: '첨부파일을 불러오지 못했습니다.' }
};
const meta = {
  en: { description: 'Simple notes, kept as GitHub Issues', sourceCode: 'View source code on GitHub' },
  ko: { description: 'GitHub Issues에 저장하는 간단한 노트', sourceCode: 'GitHub에서 소스 코드 보기' },
  'zh-CN': { description: '简洁的笔记，直接保存为 GitHub Issues', sourceCode: '在 GitHub 上查看源代码' },
  ja: { description: 'シンプルなノートを、GitHub Issuesにそのまま保存', sourceCode: 'GitHubでソースコードを見る' },
  de: { description: 'Einfache Notizen, gespeichert als GitHub Issues', sourceCode: 'Quellcode auf GitHub ansehen' },
  fr: { description: 'Des notes simples, conservées sous forme d’issues GitHub', sourceCode: 'Voir le code source sur GitHub' },
  it: { description: 'Note semplici, conservate come issue di GitHub', sourceCode: 'Visualizza il codice sorgente su GitHub' }
};
const settings = {
  en: { language: 'Language', sidebarLabel: 'Settings', patReplacementPlaceholder: 'Enter only to replace the saved PAT', backgroundRefreshInterval: 'Check for new notes', refreshDisabled: 'Off', minutes: 'minutes', hours: 'hours', workspaceCacheDuration: 'Keep workspace information for', workspaceCacheHelp: 'Restores the list state when you return within this time. It is cleared when the app reloads.', lockSessionDuration: 'Remember lock code for (cleared on refresh)', lockSessionHelp: 'How long an entered lock number stays reusable in this browser before locked notes ask for it again.', editorMaxWidth: 'Content max width' },
  ko: { language: '언어', sidebarLabel: '설정', patReplacementPlaceholder: '저장된 PAT를 바꿀 때만 입력하세요', backgroundRefreshInterval: '새 노트 확인 간격', refreshDisabled: '사용 안 함', minutes: '분', hours: '시간', workspaceCacheDuration: '저장소 전환 후 목록을 기억하는 시간', workspaceCacheHelp: '이 시간 안에 돌아오면 마지막으로 보던 목록을 다시 보여줍니다. 앱을 새로고침하면 지워집니다.', lockSessionDuration: '잠금 숫자 기억 시간 (새로고침하면 지워짐)', lockSessionHelp: '입력한 잠금 숫자를 이 브라우저에서 다시 묻지 않고 사용할 시간입니다. 시간이 지나면 잠긴 노트를 열 때 다시 입력해야 합니다.', editorMaxWidth: '본문 최대 너비' },
  'zh-CN': { language: '语言', sidebarLabel: '设置', patReplacementPlaceholder: '仅在更改已保存的 PAT 时输入', backgroundRefreshInterval: '检查新笔记', refreshDisabled: '关闭', minutes: '分钟', hours: '小时', lockSessionDuration: '锁定数字记忆时长（刷新页面后自动清除）', lockSessionHelp: '设置已输入的锁定数字在本浏览器中可重复使用的时长。超时后，锁定笔记会再次要求输入。', editorMaxWidth: '正文最大宽度' },
  ja: { language: '言語', sidebarLabel: '設定', patReplacementPlaceholder: '保存済みのPATを変更する場合のみ入力', backgroundRefreshInterval: '新しいノートの確認間隔', refreshDisabled: 'オフ', minutes: '分', hours: '時間', lockSessionDuration: 'ロック番号の記憶時間（更新時に自動解除）', lockSessionHelp: '一度入力したロック番号をこのブラウザで再利用できる時間です。経過するとロックされたノートで再入力を求められます。', editorMaxWidth: '本文の最大幅' },
  de: { language: 'Sprache', sidebarLabel: 'Einstellungen', patReplacementPlaceholder: 'Nur zum Ändern des gespeicherten PAT eingeben', backgroundRefreshInterval: 'Nach neuen Notizen suchen', refreshDisabled: 'Aus', minutes: 'Minuten', hours: 'Stunden', lockSessionDuration: 'Sperrzahl merken für (wird beim Neuladen gelöscht)', lockSessionHelp: 'Wie lange eine eingegebene Sperrzahl in diesem Browser wiederverwendbar bleibt, bevor gesperrte Notizen erneut danach fragen.', editorMaxWidth: 'Maximale Inhaltsbreite' },
  fr: { language: 'Langue', sidebarLabel: 'Paramètres', patReplacementPlaceholder: 'Saisir uniquement pour remplacer le PAT enregistré', backgroundRefreshInterval: 'Rechercher de nouvelles notes', refreshDisabled: 'Désactivé', minutes: 'minutes', hours: 'heures', lockSessionDuration: 'Mémoriser le code de verrouillage pendant (effacé au rechargement)', lockSessionHelp: 'Durée pendant laquelle un code de verrouillage saisi reste réutilisable dans ce navigateur avant que les notes verrouillées le redemandent.', editorMaxWidth: 'Largeur maximale du contenu' },
  it: { language: 'Lingua', sidebarLabel: 'Impostazioni', patReplacementPlaceholder: 'Inserisci solo per sostituire il PAT salvato', backgroundRefreshInterval: 'Controlla nuove note', refreshDisabled: 'Disattivato', minutes: 'minuti', hours: 'ore', lockSessionDuration: 'Ricorda il codice di blocco per (cancellato al ricaricamento)', lockSessionHelp: 'Per quanto tempo un codice di blocco inserito resta riutilizzabile in questo browser prima che le note bloccate lo richiedano di nuovo.', editorMaxWidth: 'Larghezza massima del contenuto' }
};
const setup = {
  en: {
    confirmPatStorage: 'Save this PAT in this browser?\n\nIf you save it, the app can reconnect without asking for the PAT every time. Anyone who can use this browser profile may be able to use the PAT, so never enable this option on a shared or public device.\n\nIs this your personal device, and do you want to continue? Select Cancel to leave everything unchanged. You can then clear the checkbox and connect without saving the PAT.',
    wizardTitle: 'Set up Ginote', stepCount: 'Step {step} of {total}', progressLabel: 'Setup progress',
    introTitle: 'Keep personal notes in your own GitHub repository', introDescription: 'Ginote turns GitHub Issues into a simple notes app. Your notes go directly between this browser and GitHub without passing through an app server.',
    introFeatureStorage: 'Each note is stored as a GitHub Issue.', introFeatureTags: 'Labels become tags, and closed issues become trash.', introFeaturePrivacy: 'A private repository keeps your personal notes from being public.',
    accountTitle: 'First, prepare a GitHub account', accountDescription: 'You need a GitHub account to create and store notes. GitHub accounts are free to create. If you do not have one yet, create it from the link below.', createAccount: 'Create a GitHub account',
    repositoryTitle: 'Create a private notes repository', repositoryDescription: 'Create a new repository on GitHub and make sure its visibility is Private. Then paste its address below.', createRepository: 'Create a private repository on GitHub', repositoryTitleWorkspace: 'Choose a repository to use', repositoryDescriptionWorkspace: 'If you already have access to a repository, enter its address below. You can also create a new one if you need it.', createRepositoryWorkspace: 'Create a new repository on GitHub', repositoryAddress: 'Repository address', repositoryAddressHelp: 'You can enter a GitHub URL or owner/repository.',
    patTitle: 'Create and enter a PAT', patDescription: 'Ginote needs a fine-grained personal access token to read and write notes in this repository.', createPat: 'Create a PAT for this repository', patHelp: 'Allow Issues read/write access. Also allow Contents read/write access to use attachments.', rememberPat: 'Remember PAT in this browser',
    previous: 'Back', start: 'Start setup', haveAccount: 'I have an account', repositoryDone: 'Repository address entered', finish: 'Complete setup', connecting: 'Connecting…', cancel: 'Cancel', close: 'Close'
  },
  ko: {
    confirmPatStorage: '이 브라우저에 PAT를 저장할까요?\n\n저장하면 다음부터 PAT를 다시 입력하지 않고 연결할 수 있습니다. 하지만 이 브라우저 프로필을 사용할 수 있는 사람도 PAT를 사용할 수 있으므로, 공용이나 공유 기기에서는 저장하지 마세요.\n\n개인 기기인가요? 계속할까요? 취소를 누르면 저장도 연결도 하지 않습니다. 저장하지 않고 연결하려면 다음 화면에서 체크를 해제하세요.',
    wizardTitle: 'Ginote 설정', stepCount: '{total}단계 중 {step}단계', progressLabel: '설정 진행 상황',
    introTitle: '내 GitHub 저장소를 개인 노트로 사용하기', introDescription: 'Ginote는 GitHub Issues를 노트처럼 사용할 수 있게 해줍니다. 노트는 별도 서버를 거치지 않고 이 브라우저와 GitHub 사이에서 바로 주고받습니다.',
    introFeatureStorage: '노트 하나가 GitHub Issue 하나로 저장됩니다.', introFeatureTags: 'GitHub 라벨은 태그로 쓰고, 닫은 이슈는 휴지통으로 보냅니다.', introFeaturePrivacy: '비공개 저장소에 노트를 저장해 다른 사람에게 공개되지 않게 합니다.',
    accountTitle: '먼저 GitHub 계정을 준비하세요', accountDescription: '노트를 만들고 저장하려면 GitHub 계정이 필요합니다. GitHub 계정은 무료로 만들 수 있습니다. 아직 계정이 없다면 아래 링크에서 먼저 만들어주세요.', createAccount: 'GitHub 계정 만들기',
    repositoryTitle: '비공개 노트 저장소 만들기', repositoryDescription: 'GitHub에서 새 저장소를 만들고 공개 범위를 Private(비공개)로 설정하세요. 그런 다음 저장소 주소를 아래에 붙여 넣으세요.', createRepository: 'GitHub에서 비공개 저장소 만들기', repositoryTitleWorkspace: '사용할 저장소 선택', repositoryDescriptionWorkspace: '이미 접근할 수 있는 저장소가 있다면 그 주소를 아래에 입력하세요. 필요하면 새 저장소를 만들어도 됩니다.', createRepositoryWorkspace: 'GitHub에서 새 저장소 만들기', repositoryAddress: '저장소 주소', repositoryAddressHelp: 'GitHub 주소 또는 owner/repository 형식으로 입력할 수 있습니다.',
    patTitle: 'GitHub 접근 토큰(PAT) 만들기', patDescription: 'Ginote가 이 저장소의 노트를 읽고 저장하려면 Fine-grained personal access token(PAT)이 필요합니다.', createPat: '이 저장소용 PAT 만들기', patHelp: 'Issues를 읽고 쓸 수 있게 설정하세요. 첨부파일도 쓰려면 Contents도 읽기 및 쓰기로 설정하세요.', rememberPat: '이 브라우저에 PAT 저장하기',
    previous: '이전', start: '시작하기', haveAccount: '계정이 있어요', repositoryDone: '주소를 입력했어요', finish: '설정 마치기', connecting: '연결 중…', cancel: '취소', close: '닫기'
  },
  'zh-CN': {
    confirmPatStorage: '要将此 PAT 保存在本浏览器中吗？\n\n保存后，应用下次可以直接重新连接，无需再次输入 PAT。任何能使用此浏览器配置文件的人都可能使用该 PAT，因此请勿在公用或共享设备上启用此选项。\n\n这是您的个人设备，并且要继续吗？选择“取消”不会更改任何内容，也不会连接。之后您可以取消勾选，并在不保存 PAT 的情况下连接。',
    wizardTitle: '设置 Ginote', stepCount: '第 {step} 步，共 {total} 步', progressLabel: '设置进度',
    introTitle: '将自己的 GitHub 仓库变成个人笔记空间', introDescription: 'Ginote 将 GitHub Issues 变成简洁的笔记应用。笔记只在本浏览器与 GitHub 之间直接传输，不经过应用服务器。',
    introFeatureStorage: '每条笔记都保存为一个 GitHub Issue。', introFeatureTags: '标签用作分类标签，已关闭的 Issue 用作回收站。', introFeaturePrivacy: '使用私有仓库，避免个人笔记被公开。',
    accountTitle: '首先，准备一个 GitHub 账户', accountDescription: '创建和保存笔记需要 GitHub 账户。GitHub 账户可以免费注册。如果您还没有账户，请通过下方链接创建。', createAccount: '创建 GitHub 账户',
    repositoryTitle: '创建私有笔记仓库', repositoryDescription: '在 GitHub 上新建仓库，并务必将可见性设为 Private。然后将仓库地址粘贴到下方。', createRepository: '在 GitHub 上创建私有仓库', repositoryTitleWorkspace: '指定要使用的仓库', repositoryDescriptionWorkspace: '如果您已经参与某个仓库，请在下方输入其地址。如有需要，也可以新建一个仓库。', createRepositoryWorkspace: '在 GitHub 上创建新仓库', repositoryAddress: '仓库地址', repositoryAddressHelp: '可以输入 GitHub URL 或 owner/repository。',
    patTitle: '创建并输入 PAT', patDescription: 'Ginote 需要 fine-grained personal access token，才能读写此仓库中的笔记。', createPat: '为此仓库创建 PAT', patHelp: '请允许 Issues 读取和写入权限。如需使用附件，还要允许 Contents 读取和写入权限。', rememberPat: '在本浏览器中记住 PAT',
    previous: '上一步', start: '开始设置', haveAccount: '我已有账户', repositoryDone: '仓库地址已输入', finish: '完成设置', connecting: '正在连接…', cancel: '取消', close: '关闭'
  },
  ja: {
    confirmPatStorage: 'このPATをブラウザに保存しますか？\n\n保存すると、次回からPATを入力せずに再接続できます。このブラウザプロファイルを利用できる人はPATを使用できる可能性があるため、共用端末や公共の端末では絶対に有効にしないでください。\n\nこの端末は個人用で、このまま続けますか？「キャンセル」を選ぶと、変更や接続は行われません。その後、チェックを外せばPATを保存せずに接続できます。',
    wizardTitle: 'Ginoteのセットアップ', stepCount: '{total}ステップ中{step}ステップ', progressLabel: 'セットアップの進行状況',
    introTitle: '自分のGitHubリポジトリを個人用ノートに', introDescription: 'GinoteはGitHub Issuesをシンプルなノートアプリとして使えるようにします。ノートはアプリサーバーを経由せず、このブラウザとGitHubの間で直接やり取りされます。',
    introFeatureStorage: '1件のノートが1件のGitHub Issueとして保存されます。', introFeatureTags: 'ラベルはタグ、クローズしたIssueはゴミ箱として使います。', introFeaturePrivacy: '非公開リポジトリを使い、個人のノートが公開されないようにします。',
    accountTitle: 'まずGitHubアカウントを用意してください', accountDescription: 'ノートの作成と保存にはGitHubアカウントが必要です。GitHubアカウントは無料で作成できます。まだお持ちでない場合は、下のリンクから作成してください。', createAccount: 'GitHubアカウントを作成',
    repositoryTitle: '非公開のノート用リポジトリを作成してください', repositoryDescription: 'GitHubで新しいリポジトリを作成し、公開範囲を必ずPrivateに設定してください。作成後、リポジトリのアドレスを下に貼り付けます。', createRepository: 'GitHubで非公開リポジトリを作成', repositoryTitleWorkspace: '使用するリポジトリを指定してください', repositoryDescriptionWorkspace: 'すでに参加しているリポジトリがあれば、そのアドレスを下に入力してください。必要であれば新しく作成することもできます。', createRepositoryWorkspace: 'GitHubで新しいリポジトリを作成', repositoryAddress: 'リポジトリのアドレス', repositoryAddressHelp: 'GitHub URLまたはowner/repository形式で入力できます。',
    patTitle: 'PATを発行して入力してください', patDescription: 'Ginoteがこのリポジトリのノートを読み書きするには、Fine-grained personal access tokenが必要です。', createPat: 'このリポジトリ用のPATを発行', patHelp: 'Issuesの読み取り・書き込みを許可してください。添付ファイルを使う場合は、Contentsの読み取り・書き込みも許可します。', rememberPat: 'このブラウザにPATを保存する',
    previous: '戻る', start: 'セットアップを開始', haveAccount: 'アカウントを持っています', repositoryDone: 'アドレス入力完了', finish: 'セットアップ完了', connecting: '接続中…', cancel: 'キャンセル', close: '閉じる'
  },
  de: {
    confirmPatStorage: 'Dieses PAT in diesem Browser speichern?\n\nWenn Sie es speichern, kann die App künftig ohne erneute PAT-Eingabe eine Verbindung herstellen. Jeder, der dieses Browserprofil verwenden kann, könnte auch das PAT nutzen. Aktivieren Sie diese Option daher niemals auf einem öffentlichen oder gemeinsam genutzten Gerät.\n\nIst dies Ihr persönliches Gerät und möchten Sie fortfahren? Mit „Abbrechen“ bleibt alles unverändert und es wird keine Verbindung hergestellt. Sie können dann das Häkchen entfernen und eine Verbindung herstellen, ohne das PAT zu speichern.',
    wizardTitle: 'Ginote einrichten', stepCount: 'Schritt {step} von {total}', progressLabel: 'Einrichtungsfortschritt',
    introTitle: 'Persönliche Notizen im eigenen GitHub-Repository', introDescription: 'Ginote macht aus GitHub Issues eine einfache Notiz-App. Ihre Notizen werden direkt zwischen diesem Browser und GitHub übertragen, ohne einen App-Server zu durchlaufen.',
    introFeatureStorage: 'Jede Notiz wird als GitHub Issue gespeichert.', introFeatureTags: 'Labels werden zu Tags und geschlossene Issues zum Papierkorb.', introFeaturePrivacy: 'Ein privates Repository verhindert, dass persönliche Notizen öffentlich werden.',
    accountTitle: 'Bereiten Sie zuerst ein GitHub-Konto vor', accountDescription: 'Zum Erstellen und Speichern von Notizen benötigen Sie ein GitHub-Konto. Ein GitHub-Konto kann kostenlos erstellt werden. Falls Sie noch keines haben, erstellen Sie es über den folgenden Link.', createAccount: 'GitHub-Konto erstellen',
    repositoryTitle: 'Privates Notiz-Repository erstellen', repositoryDescription: 'Erstellen Sie ein neues Repository auf GitHub und setzen Sie die Sichtbarkeit unbedingt auf Private. Fügen Sie anschließend die Repository-Adresse unten ein.', createRepository: 'Privates Repository auf GitHub erstellen', repositoryTitleWorkspace: 'Wählen Sie ein Repository aus', repositoryDescriptionWorkspace: 'Wenn Sie bereits Zugriff auf ein Repository haben, geben Sie unten dessen Adresse ein. Bei Bedarf können Sie auch ein neues erstellen.', createRepositoryWorkspace: 'Neues Repository auf GitHub erstellen', repositoryAddress: 'Repository-Adresse', repositoryAddressHelp: 'Sie können eine GitHub-URL oder owner/repository eingeben.',
    patTitle: 'PAT erstellen und eingeben', patDescription: 'Ginote benötigt ein Fine-grained Personal Access Token, um Notizen in diesem Repository zu lesen und zu schreiben.', createPat: 'PAT für dieses Repository erstellen', patHelp: 'Erlauben Sie Lese- und Schreibzugriff auf Issues. Für Anhänge ist zusätzlich Lese- und Schreibzugriff auf Contents erforderlich.', rememberPat: 'PAT in diesem Browser speichern',
    previous: 'Zurück', start: 'Einrichtung starten', haveAccount: 'Ich habe ein Konto', repositoryDone: 'Adresse eingegeben', finish: 'Einrichtung abschließen', connecting: 'Verbindung wird hergestellt…', cancel: 'Abbrechen', close: 'Schließen'
  },
  fr: {
    confirmPatStorage: 'Enregistrer ce PAT dans ce navigateur ?\n\nS’il est enregistré, l’application pourra se reconnecter sans vous le redemander. Toute personne ayant accès à ce profil de navigateur pourrait utiliser le PAT. N’activez donc jamais cette option sur un appareil public ou partagé.\n\nS’agit-il de votre appareil personnel et souhaitez-vous continuer ? « Annuler » ne modifiera rien et n’établira aucune connexion. Vous pourrez ensuite décocher la case et vous connecter sans enregistrer le PAT.',
    wizardTitle: 'Configurer Ginote', stepCount: 'Étape {step} sur {total}', progressLabel: 'Progression de la configuration',
    introTitle: 'Conservez vos notes personnelles dans votre propre dépôt GitHub', introDescription: 'Ginote transforme GitHub Issues en une application de notes simple. Vos notes transitent directement entre ce navigateur et GitHub, sans passer par un serveur d’application.',
    introFeatureStorage: 'Chaque note est enregistrée sous forme de GitHub Issue.', introFeatureTags: 'Les labels deviennent des tags et les issues fermées servent de corbeille.', introFeaturePrivacy: 'Un dépôt privé empêche que vos notes personnelles soient publiques.',
    accountTitle: 'Commencez par préparer un compte GitHub', accountDescription: 'Un compte GitHub est nécessaire pour créer et enregistrer des notes. La création d’un compte GitHub est gratuite. Si vous n’en avez pas encore, créez-en un depuis le lien ci-dessous.', createAccount: 'Créer un compte GitHub',
    repositoryTitle: 'Créez un dépôt privé pour vos notes', repositoryDescription: 'Créez un dépôt sur GitHub et veillez à définir sa visibilité sur Private. Collez ensuite son adresse ci-dessous.', createRepository: 'Créer un dépôt privé sur GitHub', repositoryTitleWorkspace: 'Choisissez un dépôt à utiliser', repositoryDescriptionWorkspace: 'Si vous participez déjà à un dépôt, saisissez son adresse ci-dessous. Vous pouvez aussi en créer un nouveau si besoin.', createRepositoryWorkspace: 'Créer un nouveau dépôt sur GitHub', repositoryAddress: 'Adresse du dépôt', repositoryAddressHelp: 'Vous pouvez saisir une URL GitHub ou owner/repository.',
    patTitle: 'Créez et saisissez un PAT', patDescription: 'Ginote a besoin d’un fine-grained personal access token pour lire et écrire les notes de ce dépôt.', createPat: 'Créer un PAT pour ce dépôt', patHelp: 'Autorisez l’accès en lecture et écriture à Issues. Pour utiliser les pièces jointes, autorisez également l’accès en lecture et écriture à Contents.', rememberPat: 'Mémoriser le PAT dans ce navigateur',
    previous: 'Retour', start: 'Commencer la configuration', haveAccount: 'J’ai un compte', repositoryDone: 'Adresse saisie', finish: 'Terminer la configuration', connecting: 'Connexion…', cancel: 'Annuler', close: 'Fermer'
  },
  it: {
    confirmPatStorage: 'Salvare questo PAT nel browser?\n\nSalvandolo, l’app potrà riconnettersi senza richiederlo ogni volta. Chiunque possa usare questo profilo del browser potrebbe utilizzare il PAT, quindi non attivare mai questa opzione su un dispositivo pubblico o condiviso.\n\nQuesto è il tuo dispositivo personale e vuoi continuare? Selezionando “Annulla” non verrà modificato nulla e non verrà stabilita alcuna connessione. Potrai quindi deselezionare la casella e connetterti senza salvare il PAT.',
    wizardTitle: 'Configura Ginote', stepCount: 'Passaggio {step} di {total}', progressLabel: 'Avanzamento della configurazione',
    introTitle: 'Conserva le note personali nel tuo repository GitHub', introDescription: 'Ginote trasforma GitHub Issues in una semplice app per appunti. Le note passano direttamente tra questo browser e GitHub, senza attraversare un server dell’app.',
    introFeatureStorage: 'Ogni nota viene salvata come GitHub Issue.', introFeatureTags: 'Le etichette diventano tag e le issue chiuse diventano il cestino.', introFeaturePrivacy: 'Un repository privato impedisce che le note personali siano pubbliche.',
    accountTitle: 'Per prima cosa, prepara un account GitHub', accountDescription: 'Per creare e salvare le note è necessario un account GitHub. La creazione di un account GitHub è gratuita. Se non ne hai ancora uno, crealo dal link qui sotto.', createAccount: 'Crea un account GitHub',
    repositoryTitle: 'Crea un repository privato per le note', repositoryDescription: 'Crea un nuovo repository su GitHub e assicurati di impostarne la visibilità su Private. Quindi incolla qui sotto il suo indirizzo.', createRepository: 'Crea un repository privato su GitHub', repositoryTitleWorkspace: 'Scegli un repository da usare', repositoryDescriptionWorkspace: 'Se partecipi già a un repository, inserisci qui sotto il suo indirizzo. Puoi anche crearne uno nuovo se necessario.', createRepositoryWorkspace: 'Crea un nuovo repository su GitHub', repositoryAddress: 'Indirizzo del repository', repositoryAddressHelp: 'Puoi inserire un URL GitHub oppure owner/repository.',
    patTitle: 'Crea e inserisci un PAT', patDescription: 'Ginote richiede un fine-grained personal access token per leggere e scrivere le note in questo repository.', createPat: 'Crea un PAT per questo repository', patHelp: 'Consenti l’accesso in lettura e scrittura a Issues. Per usare gli allegati, consenti anche l’accesso in lettura e scrittura a Contents.', rememberPat: 'Ricorda il PAT in questo browser',
    previous: 'Indietro', start: 'Avvia configurazione', haveAccount: 'Ho un account', repositoryDone: 'Indirizzo inserito', finish: 'Completa configurazione', connecting: 'Connessione…', cancel: 'Annulla', close: 'Chiudi'
  }
};

const workspace = {
  en: { switcherLabel: 'Switch workspace', addWorkspace: 'Add another repository', settingsSectionTitle: 'Workspaces', settingsSectionHelp: 'Choose the order workspaces appear in, or leave one you no longer need.', moveUp: 'Move up', moveDown: 'Move down', currentBadge: 'Current', rename: 'Rename', leave: 'Deauthorize', leaveConfirm: 'Deauthorize {repo}? Its saved repository address and access token will be deleted from this browser, and you will need to reconnect later.', leftNotice: 'Deauthorized {repo}.', switchToManageTags: 'Switch to this workspace to manage its tags.', switchAction: 'Switch', moreActions: 'More actions' },
  ko: { switcherLabel: '저장소 전환', addWorkspace: '다른 저장소 추가', settingsSectionTitle: '저장소 관리', settingsSectionHelp: '저장소를 바꿀 때 표시되는 순서를 정하거나, 더 이상 쓰지 않는 저장소의 연결을 해제할 수 있습니다.', moveUp: '위로 이동', moveDown: '아래로 이동', currentBadge: '현재 사용 중', rename: '표시 이름 변경', leave: '연결 해제', leaveConfirm: '{repo}의 연결을 해제할까요? 이 브라우저에 저장된 저장소 주소와 접근 토큰이 삭제되며, 나중에 다시 연결해야 합니다.', leftNotice: '{repo}의 연결을 해제했습니다.', switchToManageTags: '태그를 관리하려면 이 저장소로 먼저 전환하세요.', switchAction: '전환', moreActions: '추가 작업' },
  'zh-CN': { switcherLabel: '切换工作区', addWorkspace: '添加其他仓库', settingsSectionTitle: '工作区', settingsSectionHelp: '设置切换时显示的顺序，或退出不再使用的工作区。', moveUp: '上移', moveDown: '下移', currentBadge: '当前使用中', rename: '重命名', leave: '取消授权', leaveConfirm: '要取消对 {repo} 的授权吗？此浏览器中保存的仓库地址和访问令牌将被删除，之后需要重新进行身份验证。', leftNotice: '已取消对 {repo} 的授权。', switchToManageTags: '切换到此工作区才能管理其标签。', switchAction: '切换', moreActions: '更多操作' },
  ja: { switcherLabel: 'ワークスペースを切り替え', addWorkspace: '別のリポジトリを追加', settingsSectionTitle: 'ワークスペース', settingsSectionHelp: '切り替え時の表示順を設定したり、使わなくなったワークスペースから退出できます。', moveUp: '上へ移動', moveDown: '下へ移動', currentBadge: '使用中', rename: '表示名を変更', leave: '認証解除', leaveConfirm: '{repo}の認証を解除しますか？このブラウザに保存されているリポジトリのアドレスとアクセストークンが削除され、後で再度認証が必要になります。', leftNotice: '{repo}の認証を解除しました。', switchToManageTags: 'このワークスペースに切り替えるとタグを管理できます。', switchAction: '切り替え', moreActions: 'その他の操作' },
  de: { switcherLabel: 'Arbeitsbereich wechseln', addWorkspace: 'Weiteres Repository hinzufügen', settingsSectionTitle: 'Arbeitsbereiche', settingsSectionHelp: 'Legen Sie die Reihenfolge fest oder verlassen Sie einen nicht mehr benötigten Arbeitsbereich.', moveUp: 'Nach oben', moveDown: 'Nach unten', currentBadge: 'Aktuell', rename: 'Umbenennen', leave: 'Autorisierung aufheben', leaveConfirm: 'Autorisierung für {repo} aufheben? Die gespeicherte Repository-Adresse und das Zugriffstoken werden aus diesem Browser gelöscht, und Sie müssen sich später erneut verbinden.', leftNotice: 'Autorisierung für {repo} aufgehoben.', switchToManageTags: 'Wechseln Sie zu diesem Arbeitsbereich, um dessen Tags zu verwalten.', switchAction: 'Wechseln', moreActions: 'Weitere Aktionen' },
  fr: { switcherLabel: 'Changer d’espace de travail', addWorkspace: 'Ajouter un autre dépôt', settingsSectionTitle: 'Espaces de travail', settingsSectionHelp: 'Choisissez l’ordre d’affichage ou quittez un espace de travail dont vous n’avez plus besoin.', moveUp: 'Monter', moveDown: 'Descendre', currentBadge: 'Actuel', rename: 'Renommer', leave: 'Révoquer l’accès', leaveConfirm: 'Révoquer l’accès à {repo} ? L’adresse du dépôt et le jeton d’accès enregistrés seront supprimés de ce navigateur, et vous devrez vous reconnecter plus tard.', leftNotice: 'Accès à {repo} révoqué.', switchToManageTags: 'Passez à cet espace de travail pour gérer ses tags.', switchAction: 'Changer', moreActions: 'Plus d’actions' },
  it: { switcherLabel: 'Cambia area di lavoro', addWorkspace: 'Aggiungi un altro repository', settingsSectionTitle: 'Aree di lavoro', settingsSectionHelp: 'Scegli l’ordine di visualizzazione oppure esci da un’area di lavoro non più necessaria.', moveUp: 'Sposta su', moveDown: 'Sposta giù', currentBadge: 'Attuale', rename: 'Rinomina', leave: 'Revoca accesso', leaveConfirm: 'Revocare l’accesso a {repo}? L’indirizzo del repository e il token di accesso salvati verranno eliminati da questo browser e sarà necessario riconnettersi in seguito.', leftNotice: 'Accesso a {repo} revocato.', switchToManageTags: 'Passa a quest’area di lavoro per gestirne i tag.', switchAction: 'Cambia', moreActions: 'Altre azioni' }
};

const help = {
  en: {
    buttonSecurity: 'Security guide', buttonMcp: 'MCP guide', buttonApp: 'Install the app', buttonKeyboard: 'Keyboard shortcuts',
    keyboardTitle: 'Keyboard shortcuts', keyboardIntro: 'Most of these shortcuts work while the note list is active. Ctrl/Cmd+R reloads the app from anywhere.', keyboardMove: 'Move through notes', keyboardOpen: 'Open the focused note; press again to start editing', keyboardNew: 'Create a new note', keyboardRefresh: 'Reload the app', keyboardWorkspaceMenu: 'Open the workspace picker; use ↑/↓ to move and Enter to switch', keyboardWorkspace: 'Switch workspace (only in the note list; registered workspaces 1~9)', keyboardEscape: 'Clear the selection, cancel a deletion, or close this guide', keyboardSelect: 'Select the focused note', keyboardRangeSelect: 'Select a range of notes', keyboardTrash: 'Move selected notes to trash', keyboardNoteActions: 'With a note open and no field focused: T adds a tag, A attaches a file, P pins, L locks or unlocks, Delete moves it to trash, G opens it on GitHub, and M opens the MD viewer.', keyboardNote: 'Most shortcuts do not run while you are typing in a field. Ctrl/Cmd+R is the browser reload shortcut.',
    securityTitle: 'Security overview',
    securityIntro: 'Ginote is a fully static web app. There is no app server that handles sign-in or saves your notes — after the app loads, everything happens directly between your browser and GitHub.',
    securityDiagramFlow: 'Your browser  ←── direct communication ──→  GitHub',
    securityDiagramNote: 'PAT, app settings, and unsaved drafts stay only in this browser',
    securityPoint1: 'Notes, tags, and attachments are stored only in the GitHub repository you choose.',
    securityPoint2: 'Your PAT and app settings stay only in this browser, and are sent only to the GitHub API for authentication.',
    securityPoint3: 'Unsaved local drafts stay only in this browser.',
    securityPoint4: "You can optionally encrypt a note's body with AES-GCM in the browser before it is ever sent.",
    securityPoint5: 'There is no API that sends your notes, PAT, or settings to the app operator, and no analytics or tracking is used.',
    securityOutro: 'Other than the normal request to download static files, no extra data leaves your browser for any server besides GitHub. Your actual notes exist only in this browser and in the GitHub repository you chose.',
    securityLinkLabel: 'Read the full explanation in the project README',
    mcpIntro: "Install GitHub's official MCP Server in an MCP-capable AI tool, and it can read and write the same GitHub Issues as your notes here.",
    appTitle: 'Install the app',
    appIntro: 'Ginote can be installed like a native app instead of staying in a browser tab.',
    appPwaSectionTitle: 'Install as a PWA',
    appPwaChromeDesktop: 'Chrome or Edge (desktop): click the install icon at the right end of the address bar, or choose "Install Ginote…" from the browser menu.',
    appPwaAndroid: 'Android Chrome: open the browser menu (⋮) and tap "Install app" or "Add to Home screen."',
    appPwaIOS: 'iPhone or iPad Safari: tap the Share button, then choose "Add to Home Screen."',
    appPwaMacSafari: 'macOS Safari (Sonoma or later): open the Share menu and choose "Add to Dock."',
    appPwaNote: "The service worker only caches the app's own static files — it never caches GitHub API responses, your PAT, or note data.",
    appDesktopSectionTitle: 'Desktop app',
    appDesktopIntro: 'A native desktop app for macOS, Windows, and Linux is also available. Like the web version, it talks to the GitHub API directly, with no extra app server.',
    appDesktopHomebrew: 'macOS via Homebrew:',
    appDesktopLinkLabel: 'Download from GitHub Releases'
  },
  ko: {
    buttonSecurity: '보안 안내', buttonMcp: 'MCP 안내', buttonApp: '설치 안내', buttonKeyboard: '단축키 안내',
    keyboardTitle: '단축키 안내', keyboardIntro: '대부분의 단축키는 노트 목록에서 사용할 수 있습니다. Ctrl/Cmd+R은 어디서든 앱을 새로고침합니다.', keyboardMove: '노트 목록에서 위·아래로 이동', keyboardOpen: '현재 노트 열기 · 한 번 더 누르면 편집', keyboardNew: '새 노트 만들기', keyboardRefresh: '앱 새로고침', keyboardWorkspaceMenu: '저장소 선택창 열기 · ↑/↓로 이동하고 Enter로 선택', keyboardWorkspace: '저장소 전환 (노트 목록에서만 · 등록된 순서 1~9)', keyboardEscape: '선택 해제 · 삭제 취소 · 안내 닫기', keyboardSelect: '현재 노트 선택', keyboardRangeSelect: 'Shift와 ↑/↓로 여러 노트 선택', keyboardTrash: '선택한 노트를 휴지통으로 이동', keyboardNoteActions: '노트를 열고 입력창에 포커스가 없을 때: T 태그 추가 · A 파일 첨부 · P 상단고정 · L 잠금/잠금 해제 · Delete 휴지통으로 이동 · G GitHub에서 보기 · M MD뷰어 열기·닫기', keyboardNote: '입력창에 글을 쓰는 동안에는 목록 단축키가 동작하지 않습니다. Ctrl/Cmd+R은 브라우저 새로고침 단축키라 예외입니다.',
    securityTitle: '보안 안내',
    securityIntro: 'Ginote는 파일로 제공되는 웹 앱이라 로그인이나 노트 저장을 처리하는 별도 앱 서버가 없습니다. 앱을 연 뒤에는 브라우저가 GitHub와 직접 통신합니다.',
    securityDiagramFlow: '사용자 브라우저  ←── 직접 통신 ──→  GitHub',
    securityDiagramNote: 'PAT · 앱 설정 · 저장 전 초안은 이 브라우저에만 보관됩니다',
    securityPoint1: '노트, 태그, 첨부파일은 사용자가 지정한 GitHub 저장소에만 저장됩니다.',
    securityPoint2: 'GitHub 접근 토큰(PAT)과 앱 설정은 이 브라우저에만 저장되며, 인증할 때만 GitHub API로 전송됩니다.',
    securityPoint3: '저장 전 로컬 초안은 이 브라우저 안에만 남습니다.',
    securityPoint4: '원하면 노트 본문을 브라우저에서 AES-GCM 방식으로 암호화한 뒤 GitHub로 보낼 수 있습니다.',
    securityPoint5: '앱 운영자에게 노트·PAT·설정을 보내는 API가 없으며, 분석이나 추적 서비스도 사용하지 않습니다.',
    securityOutro: '앱 파일을 내려받는 요청 외에는 GitHub 이외의 서버로 추가 데이터가 전송되지 않습니다. 실제 노트 데이터는 이 브라우저와 사용자가 선택한 GitHub 저장소에만 있습니다.',
    securityLinkLabel: '프로젝트 README에서 자세한 설명 보기',
    mcpIntro: 'MCP는 AI 도구가 GitHub 같은 외부 서비스를 다루게 해주는 연결 방식입니다. MCP를 지원하는 AI 도구에 GitHub 공식 MCP Server를 설치하면, 여기서 노트로 쓰는 것과 같은 GitHub Issues를 AI 도구에서도 읽고 쓸 수 있습니다.',
    appTitle: '설치 안내',
    appIntro: 'Ginote는 브라우저 탭 대신 설치형 앱처럼 사용할 수 있습니다.',
    appPwaSectionTitle: 'PWA(설치형 웹 앱)로 설치하기',
    appPwaChromeDesktop: 'Chrome·Edge(데스크톱): 주소창 오른쪽 끝의 설치 아이콘을 클릭하거나, 브라우저 메뉴에서 "Ginote 설치…"를 선택하세요.',
    appPwaAndroid: 'Android Chrome: 브라우저 메뉴(⋮)에서 "앱 설치" 또는 "홈 화면에 추가"를 누르세요.',
    appPwaIOS: 'iPhone·iPad Safari: 공유 버튼을 누른 뒤 "홈 화면에 추가"를 선택하세요.',
    appPwaMacSafari: 'macOS Safari(Sonoma 이상): 공유 메뉴에서 "Dock에 추가"를 선택하세요.',
    appPwaNote: '서비스 워커(앱 파일을 잠시 보관하는 브라우저 기능)는 앱 자체의 파일만 캐시합니다. GitHub API 응답이나 PAT, 노트 데이터는 캐시하지 않습니다.',
    appDesktopSectionTitle: '데스크톱 앱',
    appDesktopIntro: 'macOS·Windows·Linux용 데스크톱 앱도 제공됩니다. 웹 버전과 마찬가지로 별도 앱 서버 없이 GitHub API에 직접 연결합니다.',
    appDesktopHomebrew: 'macOS는 Homebrew로도 설치할 수 있습니다:',
    appDesktopLinkLabel: 'GitHub Releases에서 내려받기'
  },
  'zh-CN': {
    buttonSecurity: '安全说明', buttonMcp: 'MCP 说明', buttonApp: '安装应用', buttonKeyboard: '键盘快捷键',
    keyboardTitle: '键盘快捷键', keyboardIntro: '大多数快捷键可在笔记列表中使用。Ctrl/Cmd+R 可随时刷新应用。', keyboardMove: '在笔记间移动', keyboardOpen: '打开当前笔记；再次按下开始编辑', keyboardNew: '新建笔记', keyboardRefresh: '刷新应用', keyboardWorkspaceMenu: '打开工作区选择器；使用 ↑/↓ 移动并按 Enter 切换', keyboardWorkspace: '切换工作区（仅限笔记列表；已注册工作区的 1~9）', keyboardEscape: '取消选择、取消删除或关闭此说明', keyboardSelect: '选中当前笔记', keyboardRangeSelect: '选择一组笔记', keyboardTrash: '将选中的笔记移至回收站', keyboardNoteActions: '打开笔记且没有输入框获得焦点时：T 添加标签，A 附加文件，P 置顶，L 锁定或解锁，Delete 移入回收站，G 在 GitHub 中打开，M 打开 MD 查看器。', keyboardNote: '在输入框中输入时，大多数快捷键不会生效。Ctrl/Cmd+R 是浏览器的刷新快捷键。',
    securityTitle: '安全说明',
    securityIntro: 'Ginote 是完全静态的网页应用。没有处理登录或保存笔记的应用服务器，打开应用后的所有通信都直接发生在您的浏览器和 GitHub 之间。',
    securityDiagramFlow: '您的浏览器  ←── 直接通信 ──→  GitHub',
    securityDiagramNote: 'PAT、应用设置和未保存的草稿仅保存在此浏览器中',
    securityPoint1: '笔记、标签和附件仅保存在您指定的 GitHub 仓库中。',
    securityPoint2: 'PAT 和应用设置仅保存在此浏览器中，并且仅为身份验证发送到 GitHub API。',
    securityPoint3: '未保存的本地草稿仅保留在此浏览器中。',
    securityPoint4: '如果需要，可以在浏览器中先用 AES-GCM 加密笔记正文，再发送出去。',
    securityPoint5: '没有向应用运营者发送笔记、PAT 或设置的 API，也不使用任何分析或追踪服务。',
    securityOutro: '除了下载静态文件的一般访问请求外，不会有额外数据发送到 GitHub 以外的任何服务器。您真正的笔记数据只存在于此浏览器和您选择的 GitHub 仓库中。',
    securityLinkLabel: '在项目 README 中查看完整说明',
    mcpIntro: '在支持 MCP 的 AI 工具中安装 GitHub 官方 MCP 服务器，即可读写与此处笔记相同的 GitHub Issues。',
    appTitle: '安装应用',
    appIntro: 'Ginote 可以像原生应用一样安装，而不只是停留在浏览器标签页中。',
    appPwaSectionTitle: '安装为 PWA',
    appPwaChromeDesktop: 'Chrome / Edge（桌面版）：点击地址栏右侧的安装图标，或在浏览器菜单中选择"安装 Ginote…"。',
    appPwaAndroid: 'Android Chrome：打开浏览器菜单（⋮），点按"安装应用"或"添加到主屏幕"。',
    appPwaIOS: 'iPhone / iPad Safari：点按分享按钮，然后选择"添加到主屏幕"。',
    appPwaMacSafari: 'macOS Safari（Sonoma 或更高版本）：打开分享菜单，选择"添加到程序坞"。',
    appPwaNote: 'Service Worker 仅缓存应用自身的静态文件，绝不缓存 GitHub API 响应、PAT 或笔记数据。',
    appDesktopSectionTitle: '桌面应用',
    appDesktopIntro: '还提供适用于 macOS、Windows 和 Linux 的原生桌面应用。与网页版一样，它直接连接 GitHub API，无需任何额外的应用服务器。',
    appDesktopHomebrew: 'macOS 也可以通过 Homebrew 安装：',
    appDesktopLinkLabel: '从 GitHub Releases 下载'
  },
  ja: {
    buttonSecurity: 'セキュリティについて', buttonMcp: 'MCPガイド', buttonApp: 'アプリのインストール', buttonKeyboard: 'キーボードショートカット',
    keyboardTitle: 'キーボードショートカット', keyboardIntro: '多くのショートカットはノート一覧で使えます。Ctrl/Cmd+Rはいつでもアプリを更新します。', keyboardMove: 'ノート間を移動', keyboardOpen: '選択中のノートを開く。もう一度押すと編集を開始', keyboardNew: '新しいノートを作成', keyboardRefresh: 'アプリを更新', keyboardWorkspaceMenu: 'ワークスペース選択を開く。↑/↓で移動し、Enterで切り替え', keyboardWorkspace: 'ワークスペースを切り替え（ノート一覧のみ・登録順の1~9）', keyboardEscape: '選択を解除、削除を取り消す、またはこのガイドを閉じる', keyboardSelect: '選択中のノートを選択', keyboardRangeSelect: 'ノートを範囲選択', keyboardTrash: '選択したノートをゴミ箱へ移動', keyboardNote: '入力欄で入力中は、多くのショートカットは動作しません。Ctrl/Cmd+Rはブラウザの更新ショートカットです。',
    securityTitle: 'セキュリティについて',
    securityIntro: 'Ginoteは完全に静的なWebアプリです。ログインやノートの保存を処理するアプリサーバーは存在せず、アプリを開いた後の通信はすべてこのブラウザとGitHubの間で直接行われます。',
    securityDiagramFlow: 'このブラウザ  ←── 直接通信 ──→  GitHub',
    securityDiagramNote: 'PAT・アプリ設定・保存前の下書きはこのブラウザにのみ保存されます',
    securityPoint1: 'ノート、タグ、添付ファイルは指定したGitHubリポジトリにのみ保存されます。',
    securityPoint2: 'PATとアプリ設定はこのブラウザにのみ保存され、認証のためだけにGitHub APIへ送信されます。',
    securityPoint3: '保存前のローカル下書きはこのブラウザ内にのみ残ります。',
    securityPoint4: '必要であれば、ノート本文をブラウザ内でAES-GCM暗号化してから送信できます。',
    securityPoint5: 'ノート・PAT・設定をアプリ運営者に送信するAPIはなく、アクセス解析や追跡も行いません。',
    securityOutro: '静的ファイルをダウンロードする通常のアクセス以外に、GitHub以外のサーバーへ追加のデータが送信されることはありません。実際のノートデータが存在するのは、このブラウザと選択したGitHubリポジトリだけです。',
    securityLinkLabel: 'プロジェクトのREADMEで詳しく見る',
    mcpIntro: 'MCPに対応したAIツールにGitHub公式のMCP Serverを追加すると、ここでノートとして使っているものと同じGitHub Issuesを読み書きできます。',
    appTitle: 'アプリのインストール',
    appIntro: 'Ginoteはブラウザタブのままではなく、インストール型アプリとしても使えます。',
    appPwaSectionTitle: 'PWAとしてインストール',
    appPwaChromeDesktop: 'Chrome・Edge（デスクトップ）：アドレスバー右端のインストールアイコンをクリックするか、ブラウザメニューから「Ginoteをインストール…」を選びます。',
    appPwaAndroid: 'Android版Chrome：ブラウザメニュー（⋮）から「アプリをインストール」または「ホーム画面に追加」をタップします。',
    appPwaIOS: 'iPhone・iPad版Safari：共有ボタンをタップし、「ホーム画面に追加」を選びます。',
    appPwaMacSafari: 'macOS版Safari（Sonoma以降）：共有メニューから「Dockに追加」を選びます。',
    appPwaNote: 'サービスワーカーはアプリ自体の静的ファイルのみをキャッシュし、GitHub APIの応答やPAT、ノートデータはキャッシュしません。',
    appDesktopSectionTitle: 'デスクトップアプリ',
    appDesktopIntro: 'macOS・Windows・Linux向けのデスクトップアプリも提供されています。Web版と同様、追加のアプリサーバーを介さずGitHub APIに直接接続します。',
    appDesktopHomebrew: 'macOSではHomebrewでもインストールできます：',
    appDesktopLinkLabel: 'GitHub Releasesからダウンロード'
  },
  de: {
    buttonSecurity: 'Sicherheitsübersicht', buttonMcp: 'MCP-Anleitung', buttonApp: 'App installieren', buttonKeyboard: 'Tastenkürzel',
    keyboardTitle: 'Tastenkürzel', keyboardIntro: 'Die meisten Tastenkürzel funktionieren in der Notizliste. Mit Strg/Cmd+R laden Sie die App jederzeit neu.', keyboardMove: 'Zwischen Notizen wechseln', keyboardOpen: 'Fokussierte Notiz öffnen; erneut drücken, um zu bearbeiten', keyboardNew: 'Neue Notiz erstellen', keyboardRefresh: 'App neu laden', keyboardWorkspaceMenu: 'Arbeitsbereich-Auswahl öffnen; mit ↑/↓ bewegen und mit Enter wechseln', keyboardWorkspace: 'Arbeitsbereich wechseln (nur in der Notizliste; registrierte Arbeitsbereiche 1~9)', keyboardEscape: 'Auswahl aufheben, Löschen abbrechen oder diese Anleitung schließen', keyboardSelect: 'Fokussierte Notiz auswählen', keyboardRangeSelect: 'Mehrere Notizen als Bereich auswählen', keyboardTrash: 'Ausgewählte Notizen in den Papierkorb verschieben', keyboardNote: 'Während der Eingabe in einem Feld funktionieren die meisten Kürzel nicht. Strg/Cmd+R ist das Browser-Kürzel zum Neuladen.',
    securityTitle: 'Sicherheitsübersicht',
    securityIntro: 'Ginote ist eine vollständig statische Web-App. Es gibt keinen App-Server, der die Anmeldung oder das Speichern von Notizen übernimmt — nach dem Laden der App läuft die gesamte Kommunikation direkt zwischen diesem Browser und GitHub.',
    securityDiagramFlow: 'Dieser Browser  ←── direkte Kommunikation ──→  GitHub',
    securityDiagramNote: 'PAT, App-Einstellungen und ungespeicherte Entwürfe bleiben nur in diesem Browser',
    securityPoint1: 'Notizen, Tags und Anhänge werden nur im von Ihnen gewählten GitHub-Repository gespeichert.',
    securityPoint2: 'PAT und App-Einstellungen bleiben nur in diesem Browser und werden nur zur Authentifizierung an die GitHub-API gesendet.',
    securityPoint3: 'Ungespeicherte lokale Entwürfe bleiben nur in diesem Browser.',
    securityPoint4: 'Optional können Sie den Inhalt einer Notiz im Browser mit AES-GCM verschlüsseln, bevor er gesendet wird.',
    securityPoint5: 'Es gibt keine API, die Notizen, PAT oder Einstellungen an den App-Betreiber sendet, und es werden keine Analyse- oder Tracking-Dienste verwendet.',
    securityOutro: 'Abgesehen von der üblichen Anfrage zum Herunterladen statischer Dateien werden keine zusätzlichen Daten an einen anderen Server als GitHub gesendet. Ihre tatsächlichen Notizdaten existieren nur in diesem Browser und im gewählten GitHub-Repository.',
    securityLinkLabel: 'Vollständige Erklärung im Projekt-README lesen',
    mcpIntro: 'Fügen Sie den offiziellen GitHub MCP Server zu einem MCP-fähigen KI-Tool hinzu, damit es dieselben GitHub Issues lesen und schreiben kann, die hier als Notizen verwendet werden.',
    appTitle: 'App installieren',
    appIntro: 'Ginote lässt sich wie eine native App installieren, statt nur als Browser-Tab genutzt zu werden.',
    appPwaSectionTitle: 'Als PWA installieren',
    appPwaChromeDesktop: 'Chrome/Edge (Desktop): Klicken Sie auf das Installationssymbol am rechten Rand der Adressleiste, oder wählen Sie im Browsermenü „Ginote installieren …".',
    appPwaAndroid: 'Android Chrome: Öffnen Sie das Browsermenü (⋮) und tippen Sie auf „App installieren" oder „Zum Startbildschirm hinzufügen".',
    appPwaIOS: 'iPhone/iPad Safari: Tippen Sie auf die Teilen-Schaltfläche und wählen Sie „Zum Home-Bildschirm".',
    appPwaMacSafari: 'macOS Safari (Sonoma oder neuer): Öffnen Sie das Teilen-Menü und wählen Sie „Zum Dock hinzufügen".',
    appPwaNote: 'Der Service Worker cached nur die statischen Dateien der App selbst — niemals GitHub-API-Antworten, Ihr PAT oder Notizdaten.',
    appDesktopSectionTitle: 'Desktop-App',
    appDesktopIntro: 'Es gibt auch eine native Desktop-App für macOS, Windows und Linux. Wie die Web-Version verbindet sie sich direkt mit der GitHub-API, ohne zusätzlichen App-Server.',
    appDesktopHomebrew: 'Unter macOS auch per Homebrew installierbar:',
    appDesktopLinkLabel: 'Von GitHub Releases herunterladen'
  },
  fr: {
    buttonSecurity: 'Aperçu de la sécurité', buttonMcp: 'Guide MCP', buttonApp: 'Installer l’application', buttonKeyboard: 'Raccourcis clavier',
    keyboardTitle: 'Raccourcis clavier', keyboardIntro: 'La plupart de ces raccourcis fonctionnent dans la liste des notes. Ctrl/Cmd+R recharge l’application à tout moment.', keyboardMove: 'Parcourir les notes', keyboardOpen: 'Ouvrir la note active ; appuyez encore une fois pour modifier', keyboardNew: 'Créer une note', keyboardRefresh: 'Recharger l’application', keyboardWorkspaceMenu: 'Ouvrir le sélecteur d’espace de travail ; utiliser ↑/↓ puis Entrée pour changer', keyboardWorkspace: 'Changer d’espace de travail (uniquement dans la liste ; espaces enregistrés 1~9)', keyboardEscape: 'Annuler la sélection, une suppression ou fermer ce guide', keyboardSelect: 'Sélectionner la note active', keyboardRangeSelect: 'Sélectionner une plage de notes', keyboardTrash: 'Mettre les notes sélectionnées à la corbeille', keyboardNote: 'La plupart des raccourcis ne fonctionnent pas pendant la saisie dans un champ. Ctrl/Cmd+R est le raccourci du navigateur pour recharger la page.',
    securityTitle: 'Aperçu de la sécurité',
    securityIntro: 'Ginote est une application web entièrement statique. Il n’existe aucun serveur d’application qui gère la connexion ou l’enregistrement des notes — une fois l’application ouverte, toute la communication se fait directement entre ce navigateur et GitHub.',
    securityDiagramFlow: 'Ce navigateur  ←── communication directe ──→  GitHub',
    securityDiagramNote: 'Le PAT, les paramètres de l’application et les brouillons non enregistrés restent uniquement dans ce navigateur',
    securityPoint1: 'Les notes, les tags et les pièces jointes sont stockés uniquement dans le dépôt GitHub que vous choisissez.',
    securityPoint2: 'Le PAT et les paramètres de l’application restent uniquement dans ce navigateur, et ne sont envoyés à l’API GitHub que pour l’authentification.',
    securityPoint3: 'Les brouillons locaux non enregistrés restent uniquement dans ce navigateur.',
    securityPoint4: 'Vous pouvez éventuellement chiffrer le corps d’une note avec AES-GCM dans le navigateur avant son envoi.',
    securityPoint5: 'Aucune API n’envoie vos notes, votre PAT ou vos paramètres à l’exploitant de l’application, et aucun service d’analyse ou de suivi n’est utilisé.',
    securityOutro: 'Hormis la requête habituelle de téléchargement des fichiers statiques, aucune donnée supplémentaire n’est envoyée à un serveur autre que GitHub. Vos notes réelles n’existent que dans ce navigateur et dans le dépôt GitHub que vous avez choisi.',
    securityLinkLabel: 'Lire l’explication complète dans le README du projet',
    mcpIntro: 'Ajoutez le serveur MCP officiel de GitHub à un outil d’IA compatible MCP pour lire et écrire les mêmes GitHub Issues que celles utilisées ici comme notes.',
    appTitle: 'Installer l’application',
    appIntro: 'Ginote peut être installée comme une application native plutôt que d’être utilisée uniquement dans un onglet de navigateur.',
    appPwaSectionTitle: 'Installer en tant que PWA',
    appPwaChromeDesktop: 'Chrome/Edge (ordinateur) : cliquez sur l’icône d’installation à droite de la barre d’adresse, ou choisissez « Installer Ginote… » dans le menu du navigateur.',
    appPwaAndroid: 'Chrome sur Android : ouvrez le menu du navigateur (⋮) et appuyez sur « Installer l’application » ou « Ajouter à l’écran d’accueil ».',
    appPwaIOS: 'Safari sur iPhone/iPad : appuyez sur le bouton Partager, puis choisissez « Sur l’écran d’accueil ».',
    appPwaMacSafari: 'Safari sur macOS (Sonoma ou version ultérieure) : ouvrez le menu Partager et choisissez « Ajouter au Dock ».',
    appPwaNote: 'Le service worker ne met en cache que les fichiers statiques de l’application elle-même — jamais les réponses de l’API GitHub, votre PAT ou vos données de notes.',
    appDesktopSectionTitle: 'Application de bureau',
    appDesktopIntro: 'Une application de bureau native pour macOS, Windows et Linux est également disponible. Comme la version web, elle se connecte directement à l’API GitHub, sans serveur d’application supplémentaire.',
    appDesktopHomebrew: 'Sur macOS, également installable via Homebrew :',
    appDesktopLinkLabel: 'Télécharger depuis GitHub Releases'
  },
  it: {
    buttonSecurity: 'Panoramica sulla sicurezza', buttonMcp: 'Guida MCP', buttonApp: "Installa l'app", buttonKeyboard: 'Scorciatoie da tastiera',
    keyboardTitle: 'Scorciatoie da tastiera', keyboardIntro: 'La maggior parte delle scorciatoie funziona nell’elenco delle note. Ctrl/Cmd+R ricarica l’app in qualsiasi momento.', keyboardMove: 'Spostarsi tra le note', keyboardOpen: 'Aprire la nota attiva; premi di nuovo per iniziare a modificarla', keyboardNew: 'Creare una nuova nota', keyboardRefresh: 'Ricaricare l’app', keyboardWorkspaceMenu: 'Aprire il selettore dell’area di lavoro; usare ↑/↓ e premere Invio per cambiare', keyboardWorkspace: 'Cambiare area di lavoro (solo nell’elenco; aree registrate 1~9)', keyboardEscape: 'Deselezionare, annullare l’eliminazione o chiudere questa guida', keyboardSelect: 'Selezionare la nota attiva', keyboardRangeSelect: 'Selezionare un intervallo di note', keyboardTrash: 'Spostare le note selezionate nel cestino', keyboardNote: 'La maggior parte delle scorciatoie non funziona durante la digitazione in un campo. Ctrl/Cmd+R è la scorciatoia del browser per ricaricare la pagina.',
    securityTitle: 'Panoramica sulla sicurezza',
    securityIntro: "Ginote è un'app web completamente statica. Non esiste un server dell'app che gestisca l'accesso o il salvataggio delle note: dopo l'apertura dell'app, tutta la comunicazione avviene direttamente tra questo browser e GitHub.",
    securityDiagramFlow: 'Questo browser  ←── comunicazione diretta ──→  GitHub',
    securityDiagramNote: "PAT, impostazioni dell'app e bozze non salvate restano solo in questo browser",
    securityPoint1: 'Note, tag e allegati sono salvati solo nel repository GitHub scelto.',
    securityPoint2: "Il PAT e le impostazioni dell'app restano solo in questo browser e vengono inviati all'API di GitHub solo per l'autenticazione.",
    securityPoint3: 'Le bozze locali non salvate restano solo in questo browser.',
    securityPoint4: "Facoltativamente, il testo di una nota può essere cifrato con AES-GCM nel browser prima di essere inviato.",
    securityPoint5: "Non esiste alcuna API che invii note, PAT o impostazioni all'operatore dell'app, e non vengono utilizzati servizi di analisi o tracciamento.",
    securityOutro: 'A parte la normale richiesta di download dei file statici, nessun dato aggiuntivo viene inviato a server diversi da GitHub. I dati reali delle note esistono solo in questo browser e nel repository GitHub scelto.',
    securityLinkLabel: 'Leggi la spiegazione completa nel README del progetto',
    mcpIntro: "Aggiungi il server MCP ufficiale di GitHub a uno strumento IA compatibile con MCP per leggere e scrivere le stesse GitHub Issues usate qui come note.",
    appTitle: "Installa l'app",
    appIntro: "Ginote può essere installata come un'app nativa invece di restare in una scheda del browser.",
    appPwaSectionTitle: 'Installa come PWA',
    appPwaChromeDesktop: 'Chrome/Edge (desktop): fai clic sull\'icona di installazione all\'estrema destra della barra degli indirizzi, oppure scegli "Installa Ginote…" dal menu del browser.',
    appPwaAndroid: 'Chrome su Android: apri il menu del browser (⋮) e tocca "Installa app" o "Aggiungi a schermata Home".',
    appPwaIOS: 'Safari su iPhone/iPad: tocca il pulsante Condividi, poi scegli "Aggiungi a Home".',
    appPwaMacSafari: 'Safari su macOS (Sonoma o successivo): apri il menu Condividi e scegli "Aggiungi al Dock".',
    appPwaNote: "Il service worker memorizza nella cache solo i file statici dell'app stessa: mai le risposte dell'API GitHub, il tuo PAT o i dati delle note.",
    appDesktopSectionTitle: 'App desktop',
    appDesktopIntro: "È disponibile anche un'app desktop nativa per macOS, Windows e Linux. Come la versione web, si collega direttamente all'API di GitHub, senza alcun server dell'app aggiuntivo.",
    appDesktopHomebrew: 'Su macOS è installabile anche tramite Homebrew:',
    appDesktopLinkLabel: 'Scarica da GitHub Releases'
  }
};

addMessages('en', { ...en, dynamic: dynamic.en, errors: errors.en, meta: meta.en, settings: settings.en, setup: setup.en, workspace: workspace.en, help: help.en });
addMessages('ko', { ...ko, dynamic: dynamic.ko, errors: errors.ko, meta: meta.ko, settings: settings.ko, setup: setup.ko, workspace: workspace.ko, help: help.ko });
addMessages('zh-CN', { ...zh, dynamic: dynamicFor('zh-CN'), errors: errors.en, meta: meta['zh-CN'], settings: { ...settings.en, ...settings['zh-CN'] }, setup: setup['zh-CN'], workspace: workspace['zh-CN'], help: help['zh-CN'] });
for (const code of ['ja', 'de', 'fr', 'it']) {
  addMessages(code, { ...catalogWithOverrides(common[code]), dynamic: dynamicFor(code), errors: errors.en, meta: meta[code], settings: { ...settings.en, ...settings[code] }, setup: setup[code], workspace: workspace[code], help: help[code] });
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
