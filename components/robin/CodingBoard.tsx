"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PracticeWorkspace } from "./PracticeWorkspace";
import { StudyWorkspace } from "./StudyWorkspace";
import { isCodingTrack, type CodingTrack } from "./WorkspaceHeader";

const TRACK_STORAGE_KEY = "pi-coding-track";

/**
 * The coding workspace shell: which track is mounted.
 *
 * Two tracks rather than two pages because they are one habit. Problems build
 * the reflexes an interview asks for; the curriculum builds the engineer who
 * would pass the rest of it — and the thing that makes both stick is opening
 * the same window every day rather than remembering that a second one exists.
 *
 * Only one track is mounted at a time. That is deliberate: each holds an
 * iframe of a full third-party application, and keeping both alive would mean
 * two of those running, polling, and playing video behind a hidden panel.
 */
export function CodingBoard() {
  const searchParams = useSearchParams();

  /**
   * A `?track=` in the URL wins, and is safe to read during render: it is in
   * the request, so the server and the first client paint agree on it. It is
   * how the Learning Hub's two entries land on different halves of the same
   * workspace.
   */
  const requestedTrack = searchParams.get("track");
  const [track, setTrack] = useState<CodingTrack>(
    isCodingTrack(requestedTrack) ? requestedTrack : "problems",
  );

  useEffect(() => {
    if (isCodingTrack(requestedTrack)) {
      // Arriving with an explicit track also sets the preference: coming back
      // later without the parameter should land where you last were.
      window.localStorage.setItem(TRACK_STORAGE_KEY, requestedTrack);
      return;
    }
    // Read after mount, not during render: the server has no localStorage and
    // would otherwise disagree with the first client paint.
    const stored = window.localStorage.getItem(TRACK_STORAGE_KEY);
    if (isCodingTrack(stored)) setTrack(stored);
  }, [requestedTrack]);

  /**
   * Which track you are on is a browser preference, like the list and the rail.
   *
   * Not mirrored to the server, unlike which problem or resource is open: the
   * agents each read their own side and neither needs to know which one you
   * are looking at, so writing it down would only give a second machine a way
   * to change what this one is showing.
   */
  const chooseTrack = (next: CodingTrack) => {
    setTrack(next);
    window.localStorage.setItem(TRACK_STORAGE_KEY, next);
  };

  const chrome = { track, onTrackChange: chooseTrack };

  return track === "problems"
    ? <PracticeWorkspace {...chrome} />
    : <StudyWorkspace {...chrome} />;
}
