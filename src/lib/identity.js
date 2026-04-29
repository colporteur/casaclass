// Soft identity: a name the user types in once and we remember in their browser.
// Not authentication — just attribution for questions, resources, and suggestions.

const KEY = 'casa-class:display-name'

export function getDisplayName() {
  try {
    return localStorage.getItem(KEY) || ''
  } catch {
    return ''
  }
}

export function setDisplayName(name) {
  try {
    if (name) localStorage.setItem(KEY, name)
    else localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
