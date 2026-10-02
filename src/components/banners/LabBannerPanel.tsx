import { BannerPlacementPanel } from './BannerPlacementPanel';

/**
 * The promotional banner shown at the top of the Lab section, below its own
 * search bar — the identical kind of swipeable strip as
 * [../../components/banners/HomeBannerPanel]'s, just its own placement
 * (migration 0069). Empty until staff add one: unlike Home, the apps show
 * nothing here rather than a bundled default image.
 */
export function LabBannerPanel() {
  return (
    <BannerPlacementPanel
      placement="lab"
      description="The banner shown at the top of the Lab section, below its search bar. Nothing shows there until you add one here."
      emptyMessage="No banners yet — the Lab section shows nothing here until you add one."
      activeLabel="Show on the Lab section"
      removalMessage={(title) =>
        `"${title}" will be removed from the Lab section. This cannot be undone.`
      }
    />
  );
}
