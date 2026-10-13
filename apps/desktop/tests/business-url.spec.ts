import { expect, it } from 'vitest'
import { validateBusinessWebURL } from '../src/desktop-business-url.ts'

it('normalizes a configured business origin', () => {
  expect(validateBusinessWebURL('https://app.example.test')).toBe('https://app.example.test/')
})

it.each([
  'http://app.example.test',
  'https://user:secret@app.example.test',
  'https://app.example.test/path',
  'https://app.example.test/?token=value',
  'https://app.example.test/#token=value',
])('rejects an unsafe business address %s', (value) => {
  expect(() => validateBusinessWebURL(value)).toThrow()
})
