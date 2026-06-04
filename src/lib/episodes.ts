export type Episode = {
  /** YouTube video id */
  id: string
  /** Episode number in the numbered series, or null for standalone videos */
  ep: string | null
  title: string
}

/**
 * The "Build a backend-less website with BFFless" numbered episode series,
 * plus the standalone chat walkthrough. Each demo page features the episode(s)
 * that correspond to the capability it shows off.
 */
export const EPISODES = {
  contactForm: {
    id: 'fERJjwsLnSI',
    ep: '05',
    title: 'Pipelines: Contact Form Handler',
  },
  contactUploads: {
    id: 'H-gKiRTRhUI',
    ep: '07',
    title: 'Contact Form with Uploads',
  },
  comments: {
    id: 'rJxyexhAh68',
    ep: '08',
    title: 'Ship a Comment System',
  },
  chat: {
    id: 'ZSVhrUhTFoQ',
    ep: null,
    title: 'Chat AI SDK and BFFless',
  },
  authorization: {
    id: '7llod4HV-Ec',
    ep: '14',
    title: 'Authorization: Roles, Permissions, and Access Control',
  },
  authentication: {
    id: 'JGGzf83m5wQ',
    ep: '15',
    title: 'Authentication',
  },
  onboarding: {
    id: 'qpdGH0Z3f7Q',
    ep: '17',
    title: 'User Onboarding Automation: Auto-grant Access on Signup',
  },
} as const satisfies Record<string, Episode>

export const thumbHi = (id: string) =>
  `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`
export const thumbLo = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
export const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`
