import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { Menu } from "@/components/player/internals/ContextMenu";
import { SelectableLink } from "@/components/player/internals/ContextMenu/Links";
import { useOverlayRouter } from "@/hooks/useOverlayRouter";
import { playerStatus } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";
import { usePreferencesStore } from "@/stores/preferences";

/**
 * Sub/Dub picker — only shown for anime media (when the player meta
 * has a `malId`).
 *
 * The Zoko anime API exposes 2 audio categories per episode:
 *   /api/mal/sub/{malId}/{episode}?worker=1
 *   /api/mal/dub/{malId}/{episode}?worker=1
 *
 * Picking a category here saves it to preferences ({category} in the
 * Zoko ServerConfig URL pattern) and triggers a re-scrape so the new
 * stream loads immediately.
 */

const MIRORU_CATEGORIES: Array<{ id: "sub" | "dub"; name: string }> = [
  { id: "sub", name: "Subbed" },
  { id: "dub", name: "Dubbed" },
];

export function MiroruServerView({ id }: { id: string }) {
  const { t } = useTranslation();
  const router = useOverlayRouter(id);
  const miroruCategory = usePreferencesStore((s) => s.miroruCategory);
  const setMiroruCategory = usePreferencesStore((s) => s.setMiroruCategory);

  const setStatus = usePlayerStore((s) => s.setStatus);
  const setResumeFromSourceId = usePlayerStore((s) => s.setResumeFromSourceId);

  // Save preference, then trigger a fresh scrape. We force ScrapingPart
  // to remount by setting a sentinel resumeFromSourceId (which is part
  // of the component's React `key`). The sentinel won't match any real
  // source id, so scraping starts from the beginning of the source order
  // — exactly what we want when the user has just changed audio category.
  const reroll = useCallback(() => {
    setResumeFromSourceId(`miroru-reroll-${Date.now()}`);
    setStatus(playerStatus.SCRAPING);
    router.close();
  }, [setResumeFromSourceId, setStatus, router]);

  const pickCategory = useCallback(
    (categoryId: "sub" | "dub") => {
      if (categoryId === miroruCategory) return;
      setMiroruCategory(categoryId);
      reroll();
    },
    [miroruCategory, setMiroruCategory, reroll],
  );

  return (
    <>
      <Menu.BackLink onClick={() => router.navigate("/")}>
        {t("player.menus.miroru.title")}
      </Menu.BackLink>
      <Menu.Section className="pb-4">
        <Menu.SectionTitle>{t("player.menus.miroru.audio")}</Menu.SectionTitle>
        {MIRORU_CATEGORIES.map((c) => (
          <SelectableLink
            key={c.id}
            selected={c.id === miroruCategory}
            onClick={() => pickCategory(c.id)}
          >
            {c.name}
          </SelectableLink>
        ))}
      </Menu.Section>
    </>
  );
}
