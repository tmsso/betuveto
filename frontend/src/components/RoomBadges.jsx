import { useTranslation } from 'react-i18next'
import { BADGE_ICONS } from './roomBadges'

/** A member's badges as icons, each with a localised tooltip / screen-reader label. */
export default function RoomBadges({ badges }) {
  const { t } = useTranslation()
  if (!badges?.length) return null
  return (
    <span className="inline-flex gap-1">
      {badges.map((badge) => (
        <span key={badge} role="img" title={t(`room.badges.${badge}`)} aria-label={t(`room.badges.${badge}`)}>
          {BADGE_ICONS[badge] ?? '•'}
        </span>
      ))}
    </span>
  )
}
