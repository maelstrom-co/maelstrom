// Every cell in the table is a string whoever opened the pull request chose,
// and GitHub rejects a comment body over 65,536 characters outright — so one
// unbounded name is enough to lose the whole comment. Long enough that a real
// name and a real address both survive intact.
export const CELL_LIMIT = 120;
