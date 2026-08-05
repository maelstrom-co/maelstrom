export class PaginationLimitError extends Error {
  constructor(url: string, pageLimit: number) {
    super(
      `${url} still returned a full page after ${pageLimit} pages — refusing to paginate further`,
    );
    this.name = 'PaginationLimitError';
  }
}
