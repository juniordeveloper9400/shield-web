import { useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Tabs } from '@/components/ui/Tabs';
import { HomeBannerPanel } from '@/components/banners/HomeBannerPanel';
import { LabBannerPanel } from '@/components/banners/LabBannerPanel';
import { CategoryBannerPanel } from '@/components/banners/CategoryBannerPanel';

type BannerTab = 'home' | 'lab' | 'categories';

/**
 * Every banner placement in the app and web build, in one place: the home
 * hero banner, the Lab section's own banner (migration 0069), and each
 * product category's banner, icon and sub-categories. A tab per placement
 * rather than a sidebar entry each, so a new placement added later is a tab
 * here, not another module to find.
 */
export default function BannersPage() {
  const [tab, setTab] = useState<BannerTab>('home');

  return (
    <>
      <PageHeader
        title="Banners"
        subtitle="Every banner and promotional placement across the app and web build."
      />

      <div className="mb-5">
        <Tabs
          items={[
            { key: 'home', label: 'Home' },
            { key: 'lab', label: 'Lab' },
            { key: 'categories', label: 'Categories' },
          ]}
          active={tab}
          onChange={(key) => setTab(key as BannerTab)}
        />
      </div>

      {tab === 'home' ? (
        <HomeBannerPanel />
      ) : tab === 'lab' ? (
        <LabBannerPanel />
      ) : (
        <CategoryBannerPanel />
      )}
    </>
  );
}
