export interface CommitData {
  sha: string;
  message: string;
  authorName: string;
  authorEmail: string;
  committerName: string;
  committerEmail: string;
  authorLogin: string | null;
  authorType: string | null;
  parentCount: number;
}
