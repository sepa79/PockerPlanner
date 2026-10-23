import { describe, expect, it } from 'vitest'
import { exportFilename } from './DataView'

describe('explicit JSON export filename', () => {
  it('uses the selected plan name and handles unsafe Windows names', () => {
    expect(exportFilename('Orian Increased Volumes 2026')).toBe('Orian Increased Volumes 2026.json')
    expect(exportFilename(' CON. ')).toBe('_CON.json')
    expect(exportFilename('a/b:*?')).toBe('a-b---.json')
    expect(exportFilename(' ... ')).toBe('pocketplanner-plan.json')
  })
})
