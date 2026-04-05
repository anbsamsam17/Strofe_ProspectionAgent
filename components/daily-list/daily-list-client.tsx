'use client'

import { useState } from 'react'
import type { DailyListItem, Prospect } from '@/lib/types'
import { ProspectCard } from './prospect-card'

interface DailyListClientProps {
  initialItems: (DailyListItem & { prospect: Prospect })[]
}

export function DailyListClient({ initialItems }: DailyListClientProps) {
  const [items, setItems] = useState(initialItems)

  function handleFeedbackSubmit(
    itemId: string,
    result: Partial<Pick<DailyListItem, 'call_result' | 'callback_date' | 'call_notes' | 'called_at'>>
  ) {
    setItems((prev) =>
      prev.map((item) =>
        item.id === itemId ? { ...item, ...result } : item
      )
    )
  }

  return (
    <div className="space-y-4" aria-label="Liste des appels du jour">
      {items.map((item) => (
        <ProspectCard
          key={item.id}
          item={item}
          onFeedbackSubmit={(result) => handleFeedbackSubmit(item.id, result)}
        />
      ))}
    </div>
  )
}
