import type { ScanRawResult, PushStatFn } from "../types";
import { getAccessibleName } from "../accname";
import { elementContextForAI, getSelector, outerHtmlSnippet } from "../dom-helpers";
import { isProgrammaticallyHidden, isVisible } from "../visibility";

export function runMediaRules(results: ScanRawResult[], EMIT_MANUAL_ONLY_RULES: boolean, pushStat: PushStatFn): void {
  const getMediaSources = (media: HTMLMediaElement): HTMLSourceElement[] =>
    Array.from(media.querySelectorAll("source"));

  const hasDeclaredAudioTrack = (video: HTMLVideoElement): boolean | "unknown" => {
    const audioTracks = (video as HTMLVideoElement & { audioTracks?: { length: number } }).audioTracks;
    if (audioTracks) return audioTracks.length > 0;

    // Chromium does not expose HTMLVideoElement.audioTracks, but captureStream()
    // reflects the decoded media tracks once metadata has loaded.
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      const captureStream = (video as HTMLVideoElement & {
        captureStream?: () => MediaStream;
        mozCaptureStream?: () => MediaStream;
      }).captureStream ?? (video as HTMLVideoElement & {
        mozCaptureStream?: () => MediaStream;
      }).mozCaptureStream;
      if (captureStream) {
        try {
          const stream = captureStream.call(video);
          return stream.getAudioTracks().length > 0;
        } catch {
          // Cross-origin or browser restrictions can make stream inspection
          // unavailable; continue with conservative declaration checks.
        }
      }
    }

    const sources = getMediaSources(video);
    if (sources.length === 0) return "unknown";
    for (const source of sources) {
      const type = (source.getAttribute("type") || "").toLowerCase();
      if (/^audio\//.test(type)) return true;
      if (source.hasAttribute("type") && type && !/^video\//.test(type)) return true;
      const src = source.getAttribute("src") || "";
      if (/\.(mp3|m4a|aac|wav|ogg|oga|flac)([?#].*)?$/i.test(src)) return true;
    }
    // A video/* MIME type or video filename describes the container, not its
    // streams. MP4/WebM files commonly contain audio, so absence is unknown.
    return "unknown";
  };

  const isVideoWithoutAudio = (video: HTMLVideoElement): boolean | "unknown" => {
    const trackState = hasDeclaredAudioTrack(video);
    if (trackState !== "unknown") return !trackState;
    return "unknown";
  };

  const hasVisibleAccessibleAlternative = (media: Element): boolean => {
    const describesAlternative = (text: string): boolean => {
      const normalized = text.replace(/\s+/g, " ").trim();
      if (!normalized) return false;
      const alternativeTerms = /transcript|text version|text alternative|audio description|described version|video alternative|audio alternative|alternative/i;
      if (!alternativeTerms.test(normalized)) return false;
      const negativeClaim = /\b(no|not|without|missing|omit(?:s|ted)?|incomplete|unavailable|not provided)\b.{0,100}\b(transcript|text version|text alternative|audio description|described version|video alternative|audio alternative|alternative)\b/i;
      return !negativeClaim.test(normalized);
    };

    const describedBy = media.getAttribute("aria-describedby");
    if (describedBy) {
      const references = describedBy.split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter((el): el is HTMLElement => !!el);
      if (references.some((el) =>
        isVisible(el) &&
        !isProgrammaticallyHidden(el) &&
        describesAlternative(getAccessibleName(el).trim() || (el.textContent || "").trim())
      )) return true;
    }
    const container = media.closest("figure,section,article,div") ?? media.parentElement;
    if (!container) return false;
    const candidates = Array.from(container.querySelectorAll("a[href], [role='link'], p, figcaption, [id], [class]"))
      .filter((el) => el !== media && isVisible(el) && !isProgrammaticallyHidden(el));
    return candidates.some((el) => {
      const text = getAccessibleName(el).trim() || (el.textContent || "").trim();
      return describesAlternative(text);
    });
  };

  const hasDeclaredMediaAlternative = (media: HTMLMediaElement): boolean => {
    const declaredTrack = !!media.querySelector(
      'track[kind="captions"], track[kind="subtitles"], track[kind="descriptions"]',
    );
    const textTrack = Array.from(media.textTracks || []).some((track) =>
      track.kind === "captions" ||
      track.kind === "subtitles" ||
      track.kind === "descriptions"
    );
    const player = media.closest(".video-js");
    const playerAlternative = !!player?.querySelector(
      ".vjs-subs-caps-button:not(.vjs-hidden), .vjs-descriptions-button:not(.vjs-disabled):not(.vjs-hidden)",
    );
    return declaredTrack || textTrack || playerAlternative || hasVisibleAccessibleAlternative(media);
  };

  const isApplicableVideo = (video: HTMLVideoElement): boolean => {
    if (isProgrammaticallyHidden(video) || !isVisible(video)) return false;
    const rect = video.getBoundingClientRect();
    return rect.width >= 20 && rect.height >= 20;
  };

  const isApplicableAudio = (audio: HTMLAudioElement): boolean => {
    if (isProgrammaticallyHidden(audio) || !isVisible(audio)) return false;
    const hasAccessiblePlayButton = !!audio.controls ||
      Array.from(audio.parentElement?.querySelectorAll("button, a[href], [role='button'], [role='link']") ?? [])
        .some((el) => isVisible(el) && !isProgrammaticallyHidden(el) && !!getAccessibleName(el));
    return hasAccessiblePlayButton || !audio.hasAttribute("controls") || !audio.paused || !audio.ended;
  };

  // ACT-R9: Meta refresh / redirect + links opening new window
  // ════════════════════════════════════════════════════════════════════════
  document.querySelectorAll("meta[http-equiv='refresh']").forEach((el) => {
    const content = el.getAttribute("content") || "";
    const match = content.match(/(\d+)/);
    const seconds = match ? parseInt(match[1], 10) : 0;
    if (seconds === 0) {
      results.push({ ruleId: "ACT-R9", type: "Issue", impact: "serious", description: `<meta http-equiv="refresh"> causes an immediate page redirect`, element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: getSelector(el) });
    } else {
      results.push({ ruleId: "ACT-R9", type: "Issue", impact: "moderate", description: `<meta http-equiv="refresh" content="${content}"> auto-refreshes the page after ${seconds}s without user control`, element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: getSelector(el) });
    }
  });
  document.querySelectorAll("a[target='_blank'], a[target='_new']").forEach((el) => {
    if (!isVisible(el)) return;
    const fullText = el.textContent || "";
    const ariaLabel = el.getAttribute("aria-label") || "";
    const title = el.getAttribute("title") || "";
    const combined = (fullText + " " + ariaLabel + " " + title).toLowerCase();
    const warningPhrases = ["new window","new tab","opens in","external","new page","neues","nouvel"];
    if (!warningPhrases.some((p) => combined.includes(p))) {
      const hasHiddenWarning = Array.from(el.querySelectorAll("*")).some((child) => {
        const childText = (child.textContent || "").toLowerCase();
        return warningPhrases.some((p) => childText.includes(p));
      });
      // New-window link emitter removed from R9 — it duplicated ACT-R84(link),
      // which already flags target="_blank" links without a warning.
      void hasHiddenWarning;
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // ACT-R47: Viewport zoom disabled (WCAG 1.4.4)
  // ════════════════════════════════════════════════════════════════════════
  {
    const viewportMeta = document.querySelector('meta[name="viewport"]');
    if (viewportMeta) {
      const content = viewportMeta.getAttribute("content") || "";
      if (content.includes("user-scalable=no") || /maximum-scale\s*=\s*1(?![\d.])/.test(content)) {
        results.push({ ruleId: "ACT-R47", type: "Issue", impact: "serious", description: "Viewport zoom is disabled via meta tag", element: outerHtmlSnippet(viewportMeta), elementContext: elementContextForAI(viewportMeta), selector: 'meta[name="viewport"]' });
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // ACT-R26 / ACT-R29 / ACT-R30 / ACT-R31:
  // Alfa media applicability and media-text-alternative expectations.
  // R37/R38 remain Potential Issues below because completeness requires review.
  // ════════════════════════════════════════════════════════════════════════
  document.querySelectorAll("video").forEach((video) => {
    if (!(video instanceof HTMLVideoElement) || !isApplicableVideo(video)) return;
    const silentState = isVideoWithoutAudio(video);
    const hasAlternative = hasVisibleAccessibleAlternative(video);
    // Unknown audio presence must not suppress R31. Because equivalence still
    // requires human review, the conservative result remains a Potential Issue.
    const ruleId = silentState === true ? "ACT-R26" : "ACT-R31";
    if (!hasAlternative) {
      results.push({ ruleId, type: "Potential Issue", impact: "serious", description: silentState === true
        ? "Video without audio may not have a visible text alternative labeled as a video alternative"
        : "Video with audio may not have a visible text alternative labeled as a video alternative", element: outerHtmlSnippet(video), elementContext: elementContextForAI(video), selector: getSelector(video) });
    }
  });

  document.querySelectorAll("audio").forEach((audio) => {
    if (!(audio instanceof HTMLAudioElement) || !isApplicableAudio(audio)) return;
    const transcript = hasVisibleAccessibleAlternative(audio);
    if (!transcript) {
      results.push({ ruleId: "ACT-R29", type: "Potential Issue", impact: "serious", description: "Audio may not have a visible text alternative labeled as an audio alternative", element: outerHtmlSnippet(audio), elementContext: elementContextForAI(audio), selector: getSelector(audio) });
    }
  });

  // ACT-R33: The presence of a caption, transcript, description, or other
  // declared media alternative does not prove that it conveys every meaningful
  // part of the recording. Emit one Potential Issue per applicable media
  // element with a concrete alternative so a reviewer can compare the content.
  document.querySelectorAll("video, audio").forEach((media) => {
    if (!(media instanceof HTMLMediaElement)) return;
    const applicable = media instanceof HTMLVideoElement
      ? isApplicableVideo(media)
      : media instanceof HTMLAudioElement && isApplicableAudio(media);
    if (!applicable || !hasDeclaredMediaAlternative(media)) return;
    results.push({
      ruleId: "ACT-R33",
      type: "Potential Issue",
      impact: "serious",
      description: "The detected media alternative may not fully represent all audible and visual content — verify that it is accurate, complete, and equivalent",
      element: outerHtmlSnippet(media),
      elementContext: elementContextForAI(media),
      selector: getSelector(media),
    });
  });

  // ACT-R30 is Alfa's composite audio rule: it passes when either the
  // transcript/alternative check or R29's audio media-alternative check passes.
  // The browser engine cannot prove content equivalence, so failures remain
  // Potential Issues for manual review.
  document.querySelectorAll("audio").forEach((audio) => {
    if (!(audio instanceof HTMLAudioElement) || !isApplicableAudio(audio)) return;
    if (!hasVisibleAccessibleAlternative(audio)) {
      results.push({ ruleId: "ACT-R30", type: "Potential Issue", impact: "serious", description: "Audio may not have a text alternative — review the transcript or equivalent content", element: outerHtmlSnippet(audio), elementContext: elementContextForAI(audio), selector: getSelector(audio) });
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // ACT-R27: Video element auditory content has accessible alternative
  // ════════════════════════════════════════════════════════════════════════
  document.querySelectorAll("video").forEach((video) => {
    // Alfa's R27 is a composite of caption and text-alternative questions.
    // The browser engine cannot answer those questions automatically, so the
    // extension does not emit R27 as a confirmed result.
    if (!EMIT_MANUAL_ONLY_RULES) return;
    if (!(video instanceof HTMLVideoElement)) return;
    if (isProgrammaticallyHidden(video)) return;
    const rect = video.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) return;
    const hasTrackCaptions = !!video.querySelector('track[kind="captions"], track[kind="subtitles"]');
    const hasTextTracks = video.textTracks && Array.from(video.textTracks).some((t: any) => t.kind === "captions" || t.kind === "subtitles");
    const videoJsContainer = video.closest(".video-js");
    const hasVideoJsCaptions = !!videoJsContainer?.querySelector(".vjs-subs-caps-button:not(.vjs-hidden)") && !!videoJsContainer?.querySelector(".vjs-menu-item.vjs-selected.vjs-subtitles-menu-item");
    if (!hasTrackCaptions && !hasTextTracks && !hasVideoJsCaptions) {
      results.push({ ruleId: "ACT-R27", type: "Issue", impact: "serious", description: "Video element has no captions track", element: outerHtmlSnippet(video), elementContext: elementContextForAI(video), selector: getSelector(video) });
    } else if (hasTrackCaptions && !Array.from(video.textTracks || []).some((t: any) => t.cues && t.cues.length > 0)) {
      results.push({ ruleId: "ACT-R27", type: "Potential Issue", impact: "serious", description: "Video has a captions track, but its content could not be verified — review whether captions are complete", element: outerHtmlSnippet(video), elementContext: elementContextForAI(video), selector: getSelector(video) });
    }
  });

  // ACT-R31 line-height check removed — it duplicated ACT-R73, which is the
  // Alfa rule for WCAG 1.4.8 line height (applicability: visible paragraphs).

  // ════════════════════════════════════════════════════════════════════════
  // ACT-R32: Video visual-only content has audio track alternative (SIA-R32)
  // This is not a WCAG conformance rule. The browser can detect a missing
  // declared description track on a visible silent video, but cannot prove
  // whether that track conveys all visual information, so keep it Potential.
  // ════════════════════════════════════════════════════════════════════════
  document.querySelectorAll("video").forEach((video) => {
    if (!(video instanceof HTMLVideoElement) || !isApplicableVideo(video)) return;
    if (isVideoWithoutAudio(video) !== true) return;
    const textTracks = Array.from(video.textTracks || []);
    const hasDescriptionTrack =
      !!video.querySelector('track[kind="descriptions"]') ||
      textTracks.some((track: any) => track.kind === "descriptions") ||
      !!video.closest(".video-js")?.querySelector(".vjs-descriptions-button:not(.vjs-disabled):not(.vjs-hidden)");
    if (!hasDescriptionTrack) {
      results.push({
        ruleId: "ACT-R32",
        type: "Potential Issue",
        impact: "minor",
        description: "Visual-only video has no declared audio-description track — review whether an audio alternative conveys its visual information",
        element: outerHtmlSnippet(video),
        elementContext: elementContextForAI(video),
        selector: getSelector(video),
      });
    }
  });

  // ACT-R37: Strict accessible alternative for video visual content.
  // This composite passes when either the audio-description path represented
  // by R25 or the media-alternative-for-text path represented by R31 passes.
  document.querySelectorAll("video").forEach((video) => {
    if (!(video instanceof HTMLVideoElement) || !isApplicableVideo(video)) return;
    if (isVideoWithoutAudio(video) !== false) return;
    const tracks = Array.from(video.textTracks || []);
    const hasDescriptionTrack =
      !!video.querySelector('track[kind="descriptions"]') ||
      tracks.some((track: any) => track.kind === "descriptions") ||
      !!video.closest(".video-js")?.querySelector(".vjs-descriptions-button:not(.vjs-disabled):not(.vjs-hidden)");
    const passesMediaAlternativeForText = hasVisibleAccessibleAlternative(video);
    if (hasDescriptionTrack || passesMediaAlternativeForText) return;
    results.push({
      ruleId: "ACT-R37",
      type: "Potential Issue",
      impact: "serious",
      description: "Review whether the video's visual content has a strict accessible alternative through audio description or a complete media alternative for text",
      element: outerHtmlSnippet(video),
      elementContext: elementContextForAI(video),
      selector: getSelector(video),
    });
  });

  // ACT-R38: Alternative to visual video content (SIA-R38)
  // This is intentionally a Potential Issue: automated markup checks cannot
  // establish whether an alternative fully conveys the video's visuals.
  document.querySelectorAll("video").forEach((video) => {
    if (!(video instanceof HTMLVideoElement)) return;
    if (isProgrammaticallyHidden(video)) return;
    const rect = video.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) return;
    const tracks = Array.from(video.textTracks || []);
    const hasDescriptionTrack = tracks.some((t: any) => t.kind === "descriptions");
    const videoJsContainer = video.closest(".video-js");
    const hasVideoJsDescriptions = !!videoJsContainer?.querySelector(".vjs-descriptions-button:not(.vjs-disabled):not(.vjs-hidden)");
    if (hasDescriptionTrack || hasVideoJsDescriptions) return;

    const container = video.closest("figure,section,div,article") ?? video.parentElement;
    const nearbyText = (container?.textContent ?? "").toLowerCase();
    const transcriptKeywords = ["transcript", "caption transcript", "subtitles"];
    if (transcriptKeywords.some((keyword) => nearbyText.includes(keyword))) return;
    if (video.getAttribute("aria-describedby")) return;
    if (EMIT_MANUAL_ONLY_RULES) return;
    const isSilentVideo = isVideoWithoutAudio(video) === true;
    results.push({
      ruleId: "ACT-R38",
      type: isSilentVideo ? "Issue" : "Potential Issue",
      impact: "serious",
      description: isSilentVideo
        ? "Visual-only video has no accessible alternative"
        : "Video may not have an alternative to its visual content — review whether an equivalent alternative is provided",
      element: outerHtmlSnippet(video),
      elementContext: elementContextForAI(video),
      selector: getSelector(video),
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // ACT-R23: Audio/video without transcript (WCAG 1.2.1 / 1.2.3)
  // ════════════════════════════════════════════════════════════════════════
  // The question "Is there an alternative to the visual content in this
  // video?" cannot be answered from markup. Keep it manual-only rather than
  // flagging valid videos that require human review of equivalence.
  if (EMIT_MANUAL_ONLY_RULES) {
    document.querySelectorAll("audio, video").forEach((el) => {
      if (!isVisible(el)) return;
      const parent = el.parentElement;
      const nearby = parent ? parent.textContent?.toLowerCase() || "" : "";
      const transcriptKeywords = ["transcript","text transcript","captions transcript","audio transcript","video transcript"];
      const describedBy = el.getAttribute("aria-describedby");
      if (!transcriptKeywords.some((k) => nearby.includes(k)) && !describedBy) {
        results.push({ ruleId: "ACT-R23", type: "Potential Issue", displayTitle: el.tagName.toLowerCase() === "audio" ? "Does the audio have a transcript?" : "Is there an alternative to the visual content in this video?", impact: "serious", description: `${el.tagName.toLowerCase()} element has no adjacent transcript link or text alternative — review whether a transcript is provided`, element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: getSelector(el) });
      }
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // ACT-R24: Existing media alternative may be incomplete (WCAG 1.2.3)
  // ════════════════════════════════════════════════════════════════════════
  document.querySelectorAll("video").forEach((video) => {
    if (!(video instanceof HTMLVideoElement)) return;
    if (isProgrammaticallyHidden(video)) return;
    const rect = video.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) return;
    const audioState = isVideoWithoutAudio(video);
    if (audioState === true && video.hasAttribute("autoplay")) return;
    // R24 is applicable when an alternative exists. Its completeness cannot be
    // established from markup, so surface the media as a manual-review
    // candidate rather than treating the presence of captions as a pass.
    const hasTrack = !!video.querySelector('track[kind="captions"],track[kind="subtitles"],track[kind="descriptions"]');
    const hasTextTracks = video.textTracks && Array.from(video.textTracks).some((t: any) =>
      t.kind === "captions" || t.kind === "subtitles" || t.kind === "descriptions"
    );
    const container = video.closest("figure,section,div,article") ?? video.parentElement;
    const transcriptKeywords = ["transcript", "text version", "text alternative", "text description", "read transcript"];
    const hasNearbyAlternative = Array.from(
      container?.querySelectorAll<HTMLAnchorElement>("a[href]") ?? [],
    ).some((link) => {
      const label = `${link.textContent ?? ""} ${link.getAttribute("aria-label") ?? ""}`.toLowerCase();
      return transcriptKeywords.some((keyword) => label.includes(keyword));
    });
    const hasDescribedBy = !!video.getAttribute("aria-describedby");
    if (!hasTrack && !hasTextTracks && !hasNearbyAlternative && !hasDescribedBy) return;
    if (!EMIT_MANUAL_ONLY_RULES) return;
    results.push({ ruleId: "ACT-R24", type: "Potential Issue", impact: "serious", description: "A media alternative exists — review whether it completely and accurately conveys all information in the video", element: outerHtmlSnippet(video), elementContext: elementContextForAI(video), selector: getSelector(video) });
  });

  // ════════════════════════════════════════════════════════════════════════
  // ACT-R25: Is the visual information available through the video's existing
  // audio or a separate audio-description track? This is inherently a manual
  // content judgment, so detected candidates remain Potential Issues.
  // ════════════════════════════════════════════════════════════════════════
  document.querySelectorAll("video").forEach((video) => {
    if (!(video instanceof HTMLVideoElement) || !isApplicableVideo(video)) return;
    const audioState = isVideoWithoutAudio(video);
    // Do not generalize this review question to silent videos or media whose
    // audio presence could not be established.
    if (audioState !== false) return;
    const hasDescriptions = !!video.querySelector('track[kind="descriptions"]') ||
      (video.textTracks && Array.from(video.textTracks).some((t: any) => t.kind === "descriptions"));
    const videoJsContainer = video.closest(".video-js");
    const hasVideoJsDescriptions = !!videoJsContainer?.querySelector(".vjs-descriptions-button:not(.vjs-disabled):not(.vjs-hidden)");
    if (!hasDescriptions && !hasVideoJsDescriptions) {
      results.push({ ruleId: "ACT-R25", type: "Potential Issue", impact: "serious", description: "Review whether the video's existing audio conveys all important visual information or whether a separate audio description is needed", element: outerHtmlSnippet(video), elementContext: elementContextForAI(video), selector: getSelector(video) });
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // ACT-R35: Video element visual-only content has accessible alternative
  // ════════════════════════════════════════════════════════════════════════
  document.querySelectorAll("video").forEach((video) => {
    if (!(video instanceof HTMLVideoElement)) return;
    if (isProgrammaticallyHidden(video)) return;
    const rect = video.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) return;
    const isSilent = isVideoWithoutAudio(video);
    if (isSilent !== true) return;
    // Must have no accessible alternative
    const hasTrack = !!video.querySelector('track[kind="descriptions"],track[kind="captions"]');
    if (hasTrack) return;
    const ariaLabel = (video.getAttribute("aria-label") ?? "").trim();
    const ariaLabelledby = video.getAttribute("aria-labelledby");
    const altText = video.getAttribute("alt") ?? "";
    if (ariaLabel || ariaLabelledby || altText) return;
    // Check for adjacent text description in a <figcaption> or aria-describedby
    const figcaption = video.closest("figure")?.querySelector("figcaption");
    if (figcaption?.textContent?.trim()) return;
    if (video.getAttribute("aria-describedby")) return;
    results.push({ ruleId: "ACT-R35", type: "Potential Issue", impact: "serious", description: "Muted/silent video appears to be video-only content — review whether a text alternative or description is provided", element: outerHtmlSnippet(video), elementContext: elementContextForAI(video), selector: getSelector(video) });
  });

  // ACT-R48: Media element autoplays with audio (WCAG 1.4.2)
  document.querySelectorAll("audio[autoplay], video[autoplay]").forEach((el) => {
    // Alfa alignment: only media playing longer than 3 seconds is applicable.
    const dur = (el as HTMLMediaElement).duration;
    if (isFinite(dur) && dur > 0 && dur <= 3) return;
    if (!(el as HTMLMediaElement).muted) {
      results.push({ ruleId: "ACT-R48", type: "Issue", impact: "serious", description: "Media element is autoplaying with audio", element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: getSelector(el) });
    }
  });

  // ACT-R50: Audio autoplay without controls
  document.querySelectorAll("audio").forEach((el) => {
    if ((el as HTMLAudioElement).autoplay && !(el as HTMLAudioElement).controls) {
      results.push({ ruleId: "ACT-R50", type: "Issue", impact: "serious", description: "Audio element auto-plays without visible controls", element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: getSelector(el) });
    }
  });

  // ACT-R51: Audio without controls attribute
  document.querySelectorAll("audio:not([controls])").forEach((el) => {
    if (!isVisible(el)) return;
    if ((el as HTMLAudioElement).autoplay) return;
    results.push({ ruleId: "ACT-R51", type: "Issue", impact: "serious", description: "Audio element is missing the controls attribute", element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: getSelector(el) });
  });

  // ACT-R52: Video autoplay without controls
  document.querySelectorAll("video[autoplay]:not([controls])").forEach((el) => {
    if (!isVisible(el)) return;
    results.push({ ruleId: "ACT-R52", type: "Issue", impact: "serious", description: "Video auto-plays without controls", element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: getSelector(el) });
  });

  // ── Scoring stats: total elements checked per rule ────────────────────────
  const videoElsForStats = document.querySelectorAll("video").length;
  if (videoElsForStats > 0) {
    pushStat("ACT-R24", videoElsForStats, "element");
    pushStat("ACT-R25", videoElsForStats, "element");
    pushStat("ACT-R35", videoElsForStats, "element");
    pushStat("ACT-R38", videoElsForStats, "element");
  }
  const metaRefreshEls = document.querySelectorAll("meta[http-equiv='refresh']").length;
  if (metaRefreshEls > 0) pushStat("ACT-R9", metaRefreshEls, "element");
  pushStat("ACT-R47", 1, "page");
  const applicableVideoEls = Array.from(document.querySelectorAll("video"))
    .filter((video) => !isProgrammaticallyHidden(video) && (() => {
      const rect = video.getBoundingClientRect();
      return rect.width >= 20 && rect.height >= 20;
    })()).length;
  if (applicableVideoEls > 0) {
    pushStat("ACT-R27", applicableVideoEls, "element");
    pushStat("ACT-R37", applicableVideoEls, "element");
  }
  const mediaEls = document.querySelectorAll("audio,video").length;
  if (mediaEls > 0) pushStat("ACT-R23", mediaEls, "element");
  const autoplayEls = document.querySelectorAll("audio[autoplay],video[autoplay]").length;
  if (autoplayEls > 0) pushStat("ACT-R48", autoplayEls, "element");
  const audioEls = document.querySelectorAll("audio").length;
  if (audioEls > 0) {
    pushStat("ACT-R50", audioEls, "element");
    pushStat("ACT-R51", audioEls, "element");
  }
  const applicableSilentVideoEls = Array.from(document.querySelectorAll("video"))
    .filter((video) => !isProgrammaticallyHidden(video) && (() => {
      const rect = video.getBoundingClientRect();
      return rect.width >= 20 && rect.height >= 20 && isVideoWithoutAudio(video) === true;
    })()).length;
  if (applicableSilentVideoEls > 0) {
    pushStat("ACT-R32", applicableSilentVideoEls, "element");
    pushStat("ACT-R35", applicableSilentVideoEls, "element");
  }
  const autoplayVideoEls = document.querySelectorAll("video[autoplay]").length;
  if (autoplayVideoEls > 0) pushStat("ACT-R52", autoplayVideoEls, "element");

  // ════════════════════════════════════════════════════════════════════════
}
