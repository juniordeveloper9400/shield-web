import { useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Tabs } from '@/components/ui/Tabs';
import { HomeBannerPanel } from '@/components/banners/HomeBannerPanel';
import { CategoryBannerPanel } from '@/components/banners/CategoryBannerPanel';

type BannerTab = 'home' | 'categories';

/**
 * Every banner placement in the app and web build, in one place: the home
 * hero banner and each product category's banner, icon and sub-categories.
 * A tab per placement rather than a sidebar entry each, so a new placement
 * added later is a tab here, not another module to find.
 */
export default function BannersPage() {
  const [tab, setTab] = useState<BannerTab>('home');

  return (
    <>
      <PageHeader
        title="Banners"
        subtitle="Every banner and promotional placement across the app and web home screen."
      />

      <div className="mb-5">
        <Tabs
          items={[
            { key: 'home', label: 'Home' },
            { key: 'categories', label: 'Categories' },
          ]}
          active={tab}
          onChange={(key) => setTab(key as BannerTab)}
        />
      </div>

      {tab === 'home' ? <HomeBannerPanel /> : <CategoryBannerPanel />}
    </>
  );
}
