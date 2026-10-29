import { useCallback, useEffect, useState } from 'react'
import { apiUrl } from '../constants.js'

export default function useAnnouncements({ isLoggedIn, sessionExpired, floor, selected, adminView, isExpired, askConfirm }) {
  // null until the first load finishes, so the widget shows a skeleton rather than "no announcements".
  const [announcements, setAnnouncements] = useState(null)
  const [announcementDraft, setAnnouncementDraft] = useState('')
  const [announcementError, setAnnouncementError] = useState('')
  const [announcementBusy, setAnnouncementBusy] = useState(false)

  // Announcements: a manager's (and a special-ward-only user's) on the floors list, everyone
  // else's on a single floor's page — loaded each time either opens.
  useEffect(() => {
    if (!isLoggedIn || sessionExpired || selected || adminView) return undefined
    let cancelled = false
    fetch(`${apiUrl}/announcements`, { credentials: 'include' })
      .then((response) => { isExpired(response); return response.ok ? response.json() : null })
      .then((result) => { if (!cancelled) setAnnouncements(result ? result.announcements : []) })
      .catch(() => { if (!cancelled) setAnnouncements([]) })
    return () => { cancelled = true }
  }, [isLoggedIn, sessionExpired, floor, selected, adminView, isExpired])

  const postAnnouncement = useCallback(async () => {
    const message = announcementDraft.trim()
    if (!message) return
    setAnnouncementError('')
    setAnnouncementBusy(true)
    try {
      const response = await fetch(`${apiUrl}/announcements`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ message }) })
      if (isExpired(response)) return
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'تعذر نشر الإعلان')
      setAnnouncements((current) => [result.announcement, ...(current ?? [])].slice(0, 5))
      setAnnouncementDraft('')
    } catch (error) { setAnnouncementError(error.message || 'تعذر الاتصال بالخادم') } finally { setAnnouncementBusy(false) }
  }, [announcementDraft, isExpired])
  const editAnnouncement = useCallback(async (id, message) => {
    const text = message.trim()
    if (!text) return false
    try {
      const response = await fetch(`${apiUrl}/announcements/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ message: text }) })
      if (isExpired(response) || !response.ok) return false
      const result = await response.json()
      setAnnouncements((current) => (current ?? []).map((item) => (item.id === id ? result.announcement : item)))
      return true
    } catch { return false }
  }, [isExpired])
  const deleteAnnouncement = useCallback(async (id) => {
    if (!(await askConfirm('حذف هذا الإعلان؟', { danger: true }))) return
    try {
      const response = await fetch(`${apiUrl}/announcements/${id}`, { method: 'DELETE', credentials: 'include' })
      if (isExpired(response) || !response.ok) return
      setAnnouncements((current) => (current ?? []).filter((item) => item.id !== id))
    } catch { /* the next dashboard visit will show the current list */ }
  }, [askConfirm, isExpired])
  return { announcements, announcementDraft, setAnnouncementDraft, announcementError, announcementBusy, postAnnouncement, editAnnouncement, deleteAnnouncement }
}
