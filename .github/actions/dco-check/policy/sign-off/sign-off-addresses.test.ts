import { describe, expect, it } from 'bun:test';
import { signOffAddresses } from './sign-off-addresses.ts';

describe('signOffAddresses', () => {
  it('finds no trailer in a message that carries none', () => {
    expect(signOffAddresses('feat: add a thing')).toEqual({
      trailerCount: 0,
      addresses: [],
    });
  });

  it('parses the address out of a trailer', () => {
    expect(
      signOffAddresses(
        'feat: add a thing\n\nSigned-off-by: Ada Lovelace <ada@example.com>',
      ),
    ).toEqual({ trailerCount: 1, addresses: ['ada@example.com'] });
  });

  it('finds a trailer in the middle of the body', () => {
    // This is a trailer parser, not a trailer-block parser: any line-start
    // occurrence counts, wherever it sits in the message.
    expect(
      signOffAddresses(
        [
          'feat: add a thing',
          '',
          'Signed-off-by: Ada Lovelace <ada@example.com>',
          '',
          'More prose after the trailer.',
        ].join('\n'),
      ),
    ).toEqual({ trailerCount: 1, addresses: ['ada@example.com'] });
  });

  it('collects every trailer in the message', () => {
    expect(
      signOffAddresses(
        [
          'x',
          '',
          'Signed-off-by: One <one@example.com>',
          'Signed-off-by: Two <two@example.com>',
        ].join('\n'),
      ),
    ).toEqual({
      trailerCount: 2,
      addresses: ['one@example.com', 'two@example.com'],
    });
  });

  it('parses a CRLF sign-off address with no trailing carriage return', () => {
    expect(
      signOffAddresses(
        'feat: x\r\n\r\nSigned-off-by: Ada Lovelace <ada@example.com>\r\n',
      ),
    ).toEqual({ trailerCount: 1, addresses: ['ada@example.com'] });
  });

  it('parses no address out of a CRLF trailer that carries none', () => {
    // The trailer is still counted: "signed off as nobody" is not the same
    // fact as "never signed off".
    expect(
      signOffAddresses('feat: x\r\n\r\nSigned-off-by: Ada Lovelace\r\n'),
    ).toEqual({ trailerCount: 1, addresses: [] });
  });

  it('rejects a lowercase signed-off-by prefix', () => {
    // Case-sensitivity of the prefix is a decision, so pin it.
    expect(
      signOffAddresses(
        'feat: add a thing\n\nsigned-off-by: Ada Lovelace <ada@example.com>',
      ),
    ).toEqual({ trailerCount: 0, addresses: [] });
  });

  it('rejects an indented Signed-off-by line', () => {
    // A trailer is a line-start construct, so an indented one does not count.
    expect(
      signOffAddresses(
        'feat: add a thing\n\n  Signed-off-by: Ada Lovelace <ada@example.com>',
      ),
    ).toEqual({ trailerCount: 0, addresses: [] });
  });

  it('does not let a bare trailer prefix swallow the following line', () => {
    // `\s*` after the colon would match the newline and capture the next line
    // as the trailer value, inventing an address the commit never carried.
    expect(
      signOffAddresses('Signed-off-by:\nNot A Trailer <nope@example.com>'),
    ).toEqual({ trailerCount: 1, addresses: [] });
  });

  it('reports a trailer without an address as a trailer that carries none', () => {
    expect(
      signOffAddresses('feat: add a thing\n\nSigned-off-by: Ada Lovelace'),
    ).toEqual({ trailerCount: 1, addresses: [] });
  });

  it('parses no address out of an empty angle-bracket pair', () => {
    expect(signOffAddresses('x\n\nSigned-off-by: X <>')).toEqual({
      trailerCount: 1,
      addresses: [],
    });
  });

  it('parses no address out of a whitespace-only angle-bracket pair', () => {
    // Trimming must not turn a blank address into an address.
    expect(signOffAddresses('x\n\nSigned-off-by: Attacker < >')).toEqual({
      trailerCount: 1,
      addresses: [],
    });
  });

  it('takes the final angle-bracket pair on the line', () => {
    expect(
      signOffAddresses(
        'x\n\nSigned-off-by: Ada <first@example.com> <last@example.com>',
      ),
    ).toEqual({ trailerCount: 1, addresses: ['last@example.com'] });
  });

  it('parses no address when the final angle-bracket pair is empty', () => {
    // Fails closed: an earlier well-formed pair does not rescue a line whose
    // last pair carries nothing.
    expect(
      signOffAddresses('x\n\nSigned-off-by: Ada <ada@example.com> <>'),
    ).toEqual({ trailerCount: 1, addresses: [] });
  });

  it('lowercases the address inside the final angle brackets', () => {
    expect(
      signOffAddresses('x\n\nSigned-off-by: Ada <ADA@Example.com>'),
    ).toEqual({ trailerCount: 1, addresses: ['ada@example.com'] });
  });

  it('drops only the addressless trailers from a mixed message', () => {
    expect(
      signOffAddresses(
        [
          'x',
          '',
          'Signed-off-by: No Address',
          'Signed-off-by: Ada Lovelace <ada@example.com>',
        ].join('\n'),
      ),
    ).toEqual({ trailerCount: 2, addresses: ['ada@example.com'] });
  });
});
