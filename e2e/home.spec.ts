import { test, expect } from '@playwright/test'

const MOCK_COMMENTS = {
  comments: [
    {
      id: 'c-1',
      guest_id: 'g-1',
      name: 'Ada Lovelace',
      comment: 'First!',
      createdAt: '2026-05-30T10:00:00.000Z',
    },
    {
      id: 'c-2',
      guest_id: 'g-2',
      name: 'Alan Turing',
      comment: 'Looks great.',
      createdAt: '2026-05-30T09:00:00.000Z',
    },
  ],
}

test.describe('demo site', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/comments**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_COMMENTS),
      })
    })

    // Both auth paths must be stubbed: the app reads the reverse-proxied
    // SuperTokens endpoints first (`/api/auth/*`) and only falls back to the
    // relay (`/_bffless/auth/*`). 401 on both = a guest visitor.
    await page.route('**/api/auth/**', async (route) => {
      await route.fulfill({ status: 401, body: '' })
    })

    await page.route('**/_bffless/auth/**', async (route) => {
      await route.fulfill({ status: 401, body: '' })
    })
  })

  test('renders the home hero and primary nav', async ({ page }) => {
    await page.goto('/')

    await expect(
      page.getByRole('heading', { name: /No backend to run/ }),
    ).toBeVisible()

    // Primary nav links to each feature page.
    for (const label of ['Forms', 'Comments', 'Chat', 'Auth']) {
      await expect(page.getByRole('link', { name: label, exact: true })).toBeVisible()
    }

    // Unauthenticated session => log in control.
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible()

    await page.screenshot({ path: 'screenshots/home.png', fullPage: true })
  })

  test('navigates to comments and shows mocked comments', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('link', { name: 'Comments', exact: true }).click()
    await expect(page).toHaveURL(/\/comments$/)

    await expect(page.getByText('Ada Lovelace')).toBeVisible()
    await expect(page.getByText('First!')).toBeVisible()
    await expect(page.getByText('Alan Turing')).toBeVisible()

    await page.screenshot({ path: 'screenshots/comments.png', fullPage: true })
  })
})
