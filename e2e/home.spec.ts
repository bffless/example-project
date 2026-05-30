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

test.describe('home page', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/comments**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_COMMENTS),
      })
    })

    await page.route('**/_bffless/auth/**', async (route) => {
      await route.fulfill({ status: 401, body: '' })
    })
  })

  test('renders hero, counter, and mocked comments', async ({ page }) => {
    await page.goto('/')

    await expect(
      page.getByRole('heading', { name: 'Hello BFFless from a PR!!' }),
    ).toBeVisible()

    const counter = page.getByRole('button', { name: /Count is/ })
    await expect(counter).toHaveText('Count is 0')
    await counter.click()
    await expect(counter).toHaveText('Count is 1')

    await expect(page.getByText('Ada Lovelace')).toBeVisible()
    await expect(page.getByText('First!')).toBeVisible()
    await expect(page.getByText('Alan Turing')).toBeVisible()

    await page.screenshot({
      path: 'screenshots/home.png',
      fullPage: true,
    })
  })
})
