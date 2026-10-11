export type Sent = { text: string; at: number }

const KEEP = 500
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const two = (n: number) => String(n).padStart(2, '0')

export const clockText = (at: number, now: number): string => {
  const d = new Date(at)
  const time = `${two(d.getHours())}:${two(d.getMinutes())}`
  const today = new Date(now)
  const isToday = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate()
  return isToday ? time : `${MONTHS[d.getMonth()]} ${d.getDate()} ${time}`
}

export const promptKey = (text: string) => text.trim().replace(/\s+/g, ' ').slice(0, 300)

export const withRecord = <T>(list: readonly T[], record: T): T[] => [...list, record].slice(-KEEP)

export const sentAt = (sent: readonly Sent[], text: string, drawnAt: number): number | undefined => {
  const key = promptKey(text)
  return sent.findLast(one => one.text === key && one.at <= drawnAt)?.at
}
