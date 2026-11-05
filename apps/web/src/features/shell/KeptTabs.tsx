import { useChildMatches } from '@tanstack/react-router'
import { Activity, type ReactNode, useLayoutEffect, useState } from 'react'

import { getActiveProfileId } from '../../shared/session/active-profile.ts'
import { CatalogPage } from '../catalog/CatalogPage.tsx'
import { HomePage } from '../home/HomePage.tsx'
import { WatchlistPage } from '../watchlist/WatchlistPage.tsx'

export const keptTabPaths = ['/', '/series', '/movies', '/watchlist'] as const
type TabPath = (typeof keptTabPaths)[number]

const tabOf = (path: string | undefined): TabPath | undefined =>
  keptTabPaths.find((tab) => tab === path)

export const isKeptTab = (pathname: string): boolean => tabOf(pathname) !== undefined

const pages: Record<TabPath, () => ReactNode> = {
  '/': () => <HomePage />,
  '/series': () => <CatalogPage key="series" kind="series" />,
  '/movies': () => <CatalogPage key="movies" kind="movies" />,
  '/watchlist': () => <WatchlistPage />,
}

const scrollOf = new Map<string, number>()

const TabScroll = ({ tab }: { tab: TabPath }) => {
  useLayoutEffect(() => {
    const key = `${getActiveProfileId() ?? 'none'}:${tab}`
    window.scrollTo(0, scrollOf.get(key) ?? 0)
    const save = () => scrollOf.set(key, window.scrollY)
    window.addEventListener('scroll', save, { passive: true })
    return () => window.removeEventListener('scroll', save)
  }, [tab])
  return undefined
}

export const KeptTabs = () => {
  const active = useChildMatches({
    select: (matches) => {
      const leaf = matches.at(-1)
      return leaf === undefined || leaf.status === 'pending' ? undefined : tabOf(leaf.fullPath)
    },
  })
  const [opened, setOpened] = useState<readonly TabPath[]>([])
  if (active !== undefined && !opened.includes(active)) setOpened([...opened, active])
  return keptTabPaths
    .filter((tab) => opened.includes(tab) || tab === active)
    .map((tab) => (
      <Activity key={tab} mode={tab === active ? 'visible' : 'hidden'}>
        <TabScroll tab={tab} />
        {pages[tab]()}
      </Activity>
    ))
}
