import { useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Tabs } from '@/components/ui/Tabs';
import { AllLabTests } from '@/components/labtests/AllLabTests';
import { LabTestMaster } from '@/components/labtests/LabTestMaster';
import { LabCategoriesPanel } from '@/components/labtests/LabCategoriesPanel';

type LabsTab = 'master' | 'categories' | 'all';

/**
 * Lab Tests: the laboratory's test master (tests, profiles, packages),
 * health-concern categories, and all tests master list.
 */
export default function LabsPage() {
  const [tab, setTab] = useState<LabsTab>('master');

  return (
    <>
      <PageHeader
        title="Lab Tests"
        subtitle="The laboratory's test master, health-concern categories, and diagnostic tests available for booking."
      />

      <div className="mb-5">
        <Tabs
          items={[
            { key: 'master', label: 'Test Master' },
            { key: 'categories', label: 'Categories' },
            { key: 'all', label: 'All Tests' },
          ]}
          active={tab}
          onChange={(key) => setTab(key as LabsTab)}
        />
      </div>

      {tab === 'master' ? (
        <LabTestMaster />
      ) : tab === 'all' ? (
        <AllLabTests />
      ) : (
        <LabCategoriesPanel />
      )}
    </>
  );
}
