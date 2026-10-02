import { BannerPlacementPanel } from './BannerPlacementPanel';

/**
 * The hero banner shown at the top of the app and web home screen, below the
 * search bar — one of the placements under the [BannersPage] hub, next to
 * [../../components/banners/LabBannerPanel] and
 * [../../components/banners/CategoryBannerPanel].
 */
export function HomeBannerPanel() {
  return (
    <BannerPlacementPanel
      placement="home"
      description="The hero banner shown at the top of the app and web home screen, below the search bar."
      emptyMessage="No banners yet — add one to replace the default app banner."
      activeLabel="Show on the home screen"
      removalMessage={(title) =>
        `"${title}" will be removed from the home screen. This cannot be undone.`
      }
    />
  );
}
