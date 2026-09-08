// GitHub rejects issue and issue-comment bodies over 65,536 characters.
// Keep a 10% margin so the editor never reaches the API boundary.
export const GITHUB_ISSUE_BODY_LIMIT = 65_536;
export const GITHUB_ISSUE_COMMENT_LIMIT = 65_536;
export const MAX_ISSUE_BODY_LENGTH = Math.floor(GITHUB_ISSUE_BODY_LIMIT * 0.9);
export const MAX_ISSUE_COMMENT_LENGTH = Math.floor(GITHUB_ISSUE_COMMENT_LIMIT * 0.9);
