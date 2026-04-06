import { uuid } from '../uuid';

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuid()', () => {
  it('returns a RFC 4122 v4 formatted string', () => {
    expect(uuid()).toMatch(UUID_V4_REGEX);
  });

  it('generates unique values on successive calls', () => {
    const ids = new Set(Array.from({ length: 100 }, () => uuid()));
    expect(ids.size).toBe(100);
  });

  it('sets the version nibble to 4', () => {
    const id = uuid();
    expect(id[14]).toBe('4');
  });

  it('sets the variant bits to 8, 9, a, or b', () => {
    const id = uuid();
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
  });
});
