export type RuleOutcomeType =
  | "Issue"
  | "Potential Issue"
  | "Best Practice"
  | "WAI-ARIA";
export type RuleDisplayMeta = {
  title: string;
  detail: string;
  issueTitle?: string;
  potentialTitle?: string;
  deprecated?: boolean;
  deprecatedReason?: string;
  relatedRules?: string[];
  wcagCriteria?: string[];
  wcagLevel?: string[];
  eaa?: boolean;
  ada?: boolean;
  ruleType?: RuleOutcomeType;
};

export const ACT_RULES: Record<string, RuleDisplayMeta> = {
  "ACT-R1": {
    title: "Page has no title",
    detail:
      "Every page must have a <title> element in the <head>. The title appears in the browser tab, history, and screen reader announcements, helping users understand where they are.",
  },
  "ACT-R2": {
    title: "Image without a text alternative",
    detail:
      'Informative images must have meaningful alt text. Decorative images should use alt="" so screen readers skip them entirely.',
  },
  "ACT-R3": {
    title: "Element IDs are not unique",
    detail:
      "All id attributes must be unique in the DOM. Duplicate IDs break label associations, aria-labelledby references, anchor links, and assistive-technology relationships.",
    deprecated: true,
    deprecatedReason:
      "SC 4.1.1 has been removed from WCAG 2.2 and is considered always passing for HTML pages in WCAG 2.1.",
  },
  "ACT-R4": {
    title: "Page language has not been identified",
    detail:
      "The <html> element is missing a lang attribute. Screen readers need it to apply the correct pronunciation and voice profile for the page content.",
  },
  "ACT-R5": {
    title: "Page language is not valid",
    detail:
      'The lang value on the <html> element is not a recognised BCP 47 code. Use a valid primary subtag such as "en", "fr", or "zh-Hant".',
  },
  "ACT-R6": {
    title: "Language declarations are inconsistent",
    detail:
      "Multiple lang attributes on the page contain inconsistent or invalid values, which confuses assistive technologies trying to apply the correct speech engine.",
    deprecated: true,
    deprecatedReason:
      "xml:lang attributes are no longer used in modern HTML. This rule is superseded by SIA-R4 and SIA-R5.",
  },
  "ACT-R7": {
    title: "Content language changes are not identified",
    detail:
      "When a section of content is written in a different language from the page lang, that element must declare its own lang attribute so assistive technologies switch voice correctly.",
  },
  "ACT-R8": {
    title: "Form field is not labeled",
    detail:
      "Every input, select, and textarea must be associated with a visible <label> or carry an accessible name via aria-label or aria-labelledby so screen reader users know the field's purpose.",
  },
  "ACT-R9": {
    title: "Page refreshes or redirects without user control",
    detail:
      "Automatic meta-refresh, redirects, or context changes must be avoidable or clearly communicated. Unexpected changes disorient screen reader and keyboard users.",
  },
  "ACT-R10": {
    title: "Personal data inputs missing autocomplete attributes",
    detail:
      "Inputs that collect personal information (name, email, address, etc.) must expose valid HTML autocomplete tokens so browsers and assistive tools can suggest and auto-fill values.",
  },
  "ACT-R11": {
    title: "Link missing a text alternative",
    detail:
      "Every link must have a non-empty accessible name — via visible text, aria-label, or aria-labelledby — so screen reader users understand the link destination.",
  },
  "ACT-R12": {
    title: "Button missing a text alternative",
    detail:
      "Buttons must expose a meaningful accessible name through visible text, aria-label, or an equivalent so their action is identifiable without visual context.",
  },
  "ACT-R13": {
    title: "Inline frame without a text alternative",
    detail:
      "Every <iframe> must include a title attribute that describes the embedded content, so screen reader users know what the frame contains before entering it.",
  },
  "ACT-R14": {
    title: "Visible label and  accessible name do not match",
    potentialTitle: "Does the accessible name contain the visible label?",
    issueTitle: "Visible label and accessible name do not match",
    detail:
      "The programmatic accessible name of a control must contain or closely match its visible label text, ensuring speech-input users can activate the control by speaking what they see.",
  },
  "ACT-R15": {
    title: "Multiple frames have identical accessible names",
    potentialTitle: "Are these inline frames identical?",
    issueTitle: "Multiple inline frames with the same text alternative",
    detail:
      "Each iframe or frame must have a unique and descriptive title. Identical titles prevent users from distinguishing one embedded region from another.",
  },
  "ACT-R16": {
    title: "Required ARIA attribute is missing",
    detail:
      "Many ARIA roles require specific state or property attributes to convey meaning (e.g., aria-checked on a checkbox role). Missing required attributes break assistive-technology interpretation.",
  },
  "ACT-R17": {
    title: "Hidden element has focusable content",
    detail:
      'Elements inside aria-hidden="true" regions or display:none containers must not contain keyboard-focusable children. Hidden content that remains in the tab order confuses all users.',
  },
  "ACT-R18": {
    title: "ARIA attribute unsupported or prohibited",
    detail:
      "Applying an ARIA attribute to a role that does not support it produces incorrect or meaningless semantics. Only use attributes defined as applicable for that role in the WAI-ARIA spec.",
  },
  "ACT-R19": {
    title: "Invalid state or property",
    detail:
      "ARIA attributes with enumerated values (such as aria-checked, aria-live, aria-sort) must use only the allowed values defined in the specification.",
  },
  "ACT-R20": {
    title: "ARIA attribute does not exist",
    detail:
      "Attributes starting with aria- that are not part of the WAI-ARIA specification must not be used, as assistive technologies will not recognise or convey them.",
  },
  "ACT-R21": {
    title: "Invalid ARIA role is used",
    detail:
      "Only WAI-ARIA-defined role values may be used. Invalid or misspelled roles are ignored by assistive technologies, leaving elements without semantic meaning.",
  },
  "ACT-R22": {
    title: "Does this video have captions?",
    potentialTitle: "Does this video have captions?",
    issueTitle: "Video without captions",
    detail:
      'Pre-recorded video content must include a synchronised caption track via <track kind="captions"> so deaf and hard-of-hearing users can access all spoken dialogue and audio cues.',
  },
  "ACT-R23": {
    title: "Audio or video does not have a transcript or alternative",
    potentialTitle: "Does the audio have a transcript?",
    issueTitle: "Audio without a transcript",
    detail:
      "Pre-recorded audio-only or video-only content must provide a text transcript or equivalent so users who cannot hear or see the media can access the same information.",
    relatedRules: ["ACT-R38"],
  },
  "ACT-R24": {
    title: "Media alternative may be insufficient",
    detail:
      "A text or audio alternative exists but may not fully convey all the information in the media. Review the alternative to ensure it is complete and equivalent.",
  },
  "ACT-R25": {
    title: "Is this video audio-described?",
    potentialTitle: "Is this video audio-described?",
    issueTitle: "Video is not audio-described",
    detail:
      "Pre-recorded video must include a synchronized audio description track, or an equivalent alternative version, for important visual information not conveyed by the existing audio.",
    relatedRules: ["ACT-R37"],
  },
  "ACT-R26": {
    title: "Video without audio is a media alternative for text",
    detail:
      "Visible prerecorded video without audio must have a visible text alternative and be labeled as a video alternative for text.",
  },
  "ACT-R27": {
    title: "Does this video have captions?",
    potentialTitle: "Does this video have captions?",
    issueTitle: "Video without captions",
    detail:
      'Pre-recorded video content must include a synchronised caption track via <track kind="captions"> so deaf and hard-of-hearing users can access all spoken dialogue and audio cues.',
  },
  "ACT-R28": {
    title: "Image button without a text alternative",
    detail:
      'An input[type="image"] acts as a submit button and must have an alt attribute or accessible name describing its action, not just its visual appearance.',
  },
  "ACT-R29": {
    title: "<audio> element content is media alternative for text",
    detail:
      'This rule checks audio is a media alternative for text on the page. It applies to every prerecorded <audio> element that is playing, or has a visible play button included in the accessibility tree. The auditory information must be available as visible text, directly or through text alternatives, and each target must have a visible label identifying it as an audio alternative for text on the page.',
  },
  "ACT-R30": {
    title: "Audio content has a text alternative",
    detail:
      "Audio content must have a text alternative. This composite check is satisfied when the audio transcript/alternative check or the audio media-alternative check passes.",
  },
  "ACT-R31": {
    title: "<video> element content is media alternative for text",
    detail:
      'This rule checks prerecorded video is a media alternative for text on the page. It applies to every visible prerecorded <video> element that contains audio. All information in the video must be available as visible text included in the accessibility tree, and each target must have a visible label identifying it as a video alternative for text on the page.',
  },
  "ACT-R32": {
    title: "Video visual-only content has an audio-track alternative",
    detail:
      "Visible prerecorded video without audio needs an audio track or alternative version that conveys its visual information. This is a Siteimprove best-practice check, not a WCAG conformance criterion.",
  },
  "ACT-R33": {
    title: "Media alternative may be insufficient",
    detail:
      "The detected alternative for this media element may not fully represent all its content. Verify that the alternative is accurate, complete, and equivalent.",
  },
  "ACT-R34": {
    title: "Content missing after heading",
    detail:
      "A heading element immediately followed by another heading without any content between them may indicate a structural or authoring error that confuses outline-based navigation.",
    deprecated: true,
    deprecatedReason:
      "Deprecated in the current rule set. Video description track checks are now covered by the composite ACT-R38 rule.",
  },
  "ACT-R35": {
    title: "<video> element visual-only content has accessible alternative",
    detail:
      'This rule checks that <video> elements without audio have an alternative available. It applies to every visible prerecorded <video> element that does not contain audio. Each target must pass at least one of these checks: visual-only video is a media alternative for text, visual-only video has a transcript, or visual-only video has an audio-track alternative.',
  },
  "ACT-R36": {
    title: "Unsupported or prohibited ARIA usage",
    detail:
      "Certain ARIA attributes are explicitly forbidden on specific elements or roles. Using them overrides native semantics incorrectly and may break assistive-technology behaviour.",
  },
  "ACT-R37": {
    title: "Does this video have a strict accessible alternative?",
    potentialTitle: "Does this video have a strict accessible alternative?",
    issueTitle: "Video visual content has no strict accessible alternative",
    detail:
      "The video's visual content must pass at least one path: its important visual information is available through existing audio or an audio-description track, or the video is a complete media alternative for visible text.",
  },
  "ACT-R38": {
    title: "Is there an alternative to the visual content in this video?",
    potentialTitle:
      "Is there an alternative to the visual content in this video?",
    issueTitle: "Visual-only video without an accessible alternative",
    detail:
      "A video alternative exists but may not describe all the visual information. Ensure all meaningful visuals are captured in the description or transcript.",
  },
  "ACT-R39": {
    title: "Image filename used as alternative text",
    potentialTitle: "Is this image file name an appropriate text alternative?",
    issueTitle: "Image file name is not an appropriate text alternative",
    detail:
      "The alt attribute appears to contain a raw filename (e.g., hero_img_final.jpg) rather than a meaningful description. Replace it with concise text that describes the image's content or purpose.",
  },
  "ACT-R40": {
    title: "Page region without an accessible name",
    detail:
      "When more than one landmark of the same type exists on a page (e.g., two <nav> elements), each should have a unique aria-label or aria-labelledby to distinguish them.",
  },
  "ACT-R41": {
    title: "Links with identical text have different purposes",
    potentialTitle: "Are these links identical?",
    issueTitle: "Links on the same page with the same text alternative",
    detail:
      "Multiple links sharing the same visible text but pointing to different destinations are ambiguous. Differentiate them using aria-label, additional context, or more specific link text.",
  },
  "ACT-R42": {
    title: "Role not inside the required context",
    detail:
      "Certain ARIA roles require specific parent or child roles to be valid (e.g., option inside listbox). Incorrect nesting causes assistive technologies to misinterpret the widget.",
  },
  "ACT-R43": {
    title: "Vector image without a text alternative",
    detail:
      'An SVG that conveys meaning must expose an accessible name via a <title> child element, aria-label, or aria-labelledby. Pure decorative SVGs should use aria-hidden="true".',
  },
  "ACT-R44": {
    title: "Page orientation is locked",
    detail:
      "Locking the display to portrait or landscape via CSS prevents users who mount their device in a fixed position from accessing content. Orientation should be unrestricted unless essential.",
  },
  "ACT-R45": {
    title: "Table headers aren't referenced correctly",
    detail:
      "Data tables must use <th> elements with appropriate scope or headers attributes so assistive technologies can announce the correct column or row header for each data cell.",
  },
  "ACT-R46": {
    title: "No data cells assigned to table header",
    detail:
      'Data cells (<td>) must be programmatically associated with their headers — either by placing them under a <th scope="col"> or by using the headers attribute.',
  },
  "ACT-R47": {
    title: "Page zoom is restricted",
    detail:
      "The viewport meta tag must not disable user zooming (user-scalable=no or maximum-scale=1). Users with low vision depend on browser zoom to read content.",
  },
  "ACT-R48": {
    title:
      "<audio> or <video> that plays automatically has no audio that lasts more than 3 seconds",
    detail:
      "Media that auto-plays — especially audio — must include visible controls to pause or stop it within 3 seconds, or be silent and muted by default. Auto-play disrupts screen reader users.",
  },
  "ACT-R49": {
    title:
      "<audio> or <video> that plays automatically has a control mechanism",
    detail:
      "The detected media element appears to lack a complete accessible alternative. Provide a text transcript, audio description, or equivalent that conveys all the information in the media.",
  },
  "ACT-R50": {
    title: "Audio cannot be paused or stopped",
    potentialTitle: "Can the audio be switched off?",
    issueTitle: "Audio plays automatically and can't be switched off",
    detail:
      "Auto-playing audio without pause or stop controls violates WCAG 1.4.2. Provide visible controls so users can silence audio that interferes with their screen reader output.",
  },
  "ACT-R51": {
    title: "Audio control is missing",
    detail:
      "An <audio> element is present without the controls attribute, leaving users unable to manage playback. Add the controls attribute or provide custom play/pause controls.",
  },
  "ACT-R52": {
    title: "Adjacent links do not reference the same resource",
    detail:
      "Auto-playing videos, animations, or scrolling tickers must offer a mechanism to pause, stop, or hide them. Moving content can distract users with attention or cognitive difficulties.",
  },
  "ACT-R53": {
    title: "Headings are structured",
    detail:
      "Heading levels must follow a logical hierarchy (h1 → h2 → h3) without skipping ranks. Proper structure allows screen reader users to navigate and understand the page outline.",
  },
  "ACT-R54": {
    title: "Field input error is not announced in full",
    detail:
      'Dynamic status updates (form confirmations, loading states, error counts) must use role="status", aria-live, or an equivalent so screen readers announce them without moving focus.',
  },
  "ACT-R55": {
    title: "Landmark regions have duplicate accessible names",
    detail:
      'Multiple landmark regions sharing the same name (e.g., two <section> elements both labelled "Products") make it impossible to distinguish them through assistive-technology navigation.',
  },
  "ACT-R56": {
    title: "Landmarks of same type have a unique accessible name",
    detail:
      'ARIA landmark roles must be applied consistently and correctly. Misusing roles (e.g., role="region" without a name, or role="main" used multiple times) breaks page navigation.',
  },
  "ACT-R57": {
    title: "Text not included in an ARIA landmark",
    detail:
      "Icons, input borders, focus rings, and other non-text UI components must have at least a 3:1 contrast ratio against adjacent colours (WCAG 1.4.11 AA).",
  },
  "ACT-R58": {
    title: "Repeated blocks of content can be bypassed",
    detail:
      "Repeated blocks of content, such as navigation, can be bypassed with a mechanism that moves keyboard focus directly to the main content.",
  },
  "ACT-R59": {
    title: "Documents have headings",
    detail:
      "Pages should have a meaningful heading structure. Without headings, screen reader users cannot scan the page outline or jump between content sections efficiently.",
  },
  "ACT-R60": {
    title: "Groups have an accessible name",
    detail:
      "Groups of related controls — radio buttons, checkboxes — must be wrapped in a <fieldset> element with a <legend> that describes the group's purpose.",
  },
  "ACT-R61": {
    title: "Documents start with a level 1 heading",
    detail:
      "The first heading on a page should be an <h1> that describes the page topic. Starting at <h2> or deeper deprives screen reader users of the top-level page summary.",
  },
  "ACT-R62": {
    title: "Links are not clearly identifiable",
    detail:
      "Links within body text must be distinguishable without relying on colour alone. Add an underline, bold weight, or another non-colour visual cue to identify hyperlinks.",
  },
  "ACT-R63": {
    title: "Object without a text alternative",
    detail:
      "An <object> element must provide accessible content via title, aria-label, or meaningful fallback text inside the element so its purpose is conveyed to all users.",
  },
  "ACT-R64": {
    title: "Empty headings",
    detail:
      "Heading elements (h1–h6) must contain meaningful text. An empty heading is announced as a heading by screen readers but provides no information, wasting user navigation time.",
  },
  "ACT-R65": {
    title: "Focus indicator is not visible",
    potentialTitle:
      "Is it clear which page element has focus from the keyboard?",
    issueTitle: "Keyboard focus indicator is missing",
    detail:
      "Removing the browser's default focus outline without providing an equally visible custom replacement leaves keyboard users unable to tell where focus currently is.",
  },
  "ACT-R66": {
    title: "Color contrast does not meet enhanced requirement",
    potentialTitle:
      "Is there sufficient contrast between the text and background?",
    issueTitle: "Color contrast does not meet the minimum requirement",
    detail:
      "Text should achieve at least a 7:1 contrast ratio against its background for WCAG AAA. This rule targets text or elements that fall below this enhanced threshold.",
  },
  "ACT-R67": {
    title: "Decorative image exposed to assistive technologies",
    detail:
      'Images marked as decorative via role="presentation" or role="none" should not carry descriptive alt text. Providing alt text on a decorative image will be announced unnecessarily.',
  },
  "ACT-R68": {
    title: "Container element is empty",
    detail:
      "A visible container has no meaningful content. Empty containers may be rendering artifacts that should be removed or given meaningful content and appropriate semantics.",
  },
  "ACT-R69": {
    title: "Color contrast does not meet minimum requirement",
    potentialTitle:
      "Is there sufficient contrast between the text and the background?",
    issueTitle: "Color contrast is not sufficient",
    detail:
      "Normal-size text must meet a 4.5:1 contrast ratio and large text (18pt or 14pt bold) must meet 3:1 for WCAG Level AA. Insufficient contrast impairs readability for low-vision users.",
  },
  "ACT-R70": {
    title: "No obsolete or deprecated elements are used",
    detail:
      "Obsolete elements such as <marquee>, <blink>, <center>, <font>, and <big> have been removed from the HTML spec. Replace them with CSS or semantic HTML equivalents.",
  },
  "ACT-R71": {
    title: "Uneven spacing in text",
    detail:
      "Inconsistent or excessive spacing adjustments applied through CSS may break the layout when users override text spacing via a user stylesheet (WCAG 1.4.12).",
  },
  "ACT-R72": {
    title: "Paragraphs of text are not all uppercase",
    detail:
      "Extended passages in ALL CAPS are significantly harder to read, especially for users with dyslexia. Use sentence case or title case for body text.",
  },
  "ACT-R73": {
    title: "Line height is below minimum value",
    detail:
      "Line height should be at least 1.5 times the font size. Cramped line spacing reduces readability for everyone, especially users with low vision or cognitive disabilities.",
  },
  "ACT-R74": {
    title: "Font size is fixed",
    detail:
      "Using absolute font size units (px, pt) prevents text from scaling when users change their browser's default font size. Use relative units (em, rem, %) instead.",
  },
  "ACT-R75": {
    title: "Font sizes are not too small",
    detail:
      "Text that is very small may be difficult to read and may not scale well. Ensure body text is at least 16px (1rem) and that all text remains legible when zoomed to 200%.",
  },
  "ACT-R76": {
    title: "Table header cell is missing a header role",
    detail:
      "Data tables that present rows and columns of information must include <th> elements to identify header cells, enabling screen readers to announce the context of each data cell.",
  },
  "ACT-R77": {
    title: "Table data missing context",
    detail:
      'Each <td> must be associated with its header either through column position (via <th scope="col">) or explicitly through the headers attribute referencing the relevant <th> ids.',
  },
  "ACT-R78": {
    title: "Headings of same level have text content between them",
    detail:
      "A heading at the end of a section with no subsequent content may indicate a structural issue. Headings should introduce the content that follows, not appear in isolation.",
  },
  "ACT-R79": {
    title: "Preformatted text represents either code or a figure",
    detail:
      "<pre> is meant for preformatted content such as code, ASCII art, or tabular data. Using it for general prose breaks reading flow and may disrupt screen reader announcement.",
  },
  "ACT-R80": {
    title: "Line height is fixed",
    detail:
      "Setting line-height with a fixed pixel value prevents it from scaling when users increase their text size, which can cause text to overlap on zoom.",
  },
  "ACT-R81": {
    title: "Links with identical text lead to different destinations",
    potentialTitle:
      "Do these links (in the same context) point to the same URL?",
    issueTitle: "Links in the same context have the same text alternative",
    detail:
      "When multiple links share the same visible label but point to different pages, screen reader users navigating the link list cannot distinguish them. Use unique text or aria-label to disambiguate.",
  },
  "ACT-R82": {
    title: "Error message describes invalid form field value",
    detail:
      "Content that looks like a list, heading, or table but is marked up with generic <div> or <span> elements lacks the semantic structure that assistive technologies rely on.",
  },
  "ACT-R83": {
    title: "Text is clipped when resized",
    detail:
      "Fixed-height containers with overflow:hidden clip text when users zoom or override font size. Use min-height, relative units, or overflow:auto to prevent content loss.",
    deprecated: true,
    deprecatedReason:
      "Deprecated because text clipping is no longer evaluated as an independent automated rule.",
  },
  "ACT-R84": {
    title: "Scrollable element is not keyboard accessible",
    detail:
      'Scrollable regions that cannot receive keyboard focus trap keyboard users out of that content. Add tabindex="0" to scrollable containers so they can be reached and scrolled via keyboard.',
  },
  "ACT-R85": {
    title: "Paragraphs of text are not all italics",
    detail:
      "Large passages rendered in italic are harder to read and may be misread by some screen readers. Reserve italics for short emphasis, titles, or technical terms.",
  },
  "ACT-R86": {
    title:
      "Elements that are marked as decorative are not exposed to assistive technologies",
    detail:
      'Purely decorative elements (e.g., visual dividers, spacers) should be hidden from assistive technology with aria-hidden="true" so they are not announced to screen reader users.',
  },
  "ACT-R87": {
    title: "Skip to main content link is missing",
    detail:
      "The first focusable element should be a visible, accessible link that moves focus to the main content, allowing keyboard users to bypass repeated blocks.",
  },
  "ACT-R88": {
    title: "Text in link has minimum contrast",
    detail:
      "Link text must meet the minimum contrast ratio against its background so users with low vision can read the link.",
  },
  "ACT-R89": {
    title: "Text in link has enhanced contrast",
    detail:
      "Link text must meet the enhanced contrast ratio against its background for users who need higher contrast.",
  },
  "ACT-R90": {
    title: "Role with implied hidden content has keyboard focus",
    detail:
      "Elements with interactive ARIA roles must not contain nested interactive content, and focusable elements must not be hidden inside opacity:0 containers. Both patterns create invisible or ambiguous keyboard focus that assistive technologies cannot correctly announce.",
  },
  "ACT-R91": {
    title: "Letter spacing is not wide enough",
    detail:
      "WCAG 1.4.12 requires content to remain usable when letter-spacing is increased to at least 0.12em. Layouts that break under this override need adjustment.",
  },
  "ACT-R92": {
    title: "Word spacing is not wide enough",
    detail:
      "Content must remain intact when word-spacing is set to at least 0.16em. Test with user-stylesheet overrides and ensure no text is clipped or overlaps.",
  },
  "ACT-R93": {
    title: "Line height is too narrow",
    detail:
      "Line height must remain functional when set to at least 1.5 times the font size. Content that breaks or overlaps under this override fails WCAG 1.4.12.",
  },
  "ACT-R94": {
    title: "Menu item missing a text alternative",
    detail:
      "Navigation menu items and custom widget items that lack accessible names are not announced meaningfully by screen readers. Provide visible text or aria-label.",
  },
  "ACT-R95": {
    title:
      "<iframe> element with interactive elements does not have a negative tabindex",
    detail:
      "All interactive functionality must be operable using only a keyboard. Custom widgets that respond only to mouse or touch events exclude keyboard-only and switch-access users.",
  },
  "ACT-R96": {
    title:
      "Refreshes implemented using the <meta> element have no delay, without exception",
    detail:
      "Pages that auto-update or auto-refresh without user control interrupt screen reader reading position and keyboard context. Provide a mechanism to disable or extend the interval.",
  },
  "ACT-R97": {
    title: "Document has collapsible blocks of content",
    detail:
      "Accordion and disclosure widgets must use aria-expanded to communicate open/closed state, and must be keyboard operable via Enter or Space, so all users can access collapsed content.",
  },
  "ACT-R98": {
    title: "Document has heading at the start of its main content",
    detail:
      "The primary content region should begin with a heading that describes its topic, helping screen reader users orient themselves within the page after landing on it.",
  },
  "ACT-R99": {
    title: "Document has no main landmark",
    detail:
      'Every page should expose its primary content through one <main> element or role="main" landmark so screen reader users can navigate to it directly.',
  },
  "ACT-R100": {
    title: "Document has instrument to main content",
    detail:
      "PDFs embedded or linked from a page should include accessible tags, or an equivalent HTML page should be provided for users whose assistive technology cannot read untagged PDFs.",
  },
  "ACT-R101": {
    title: "Repeated content before main content can be bypassed",
    detail:
      "Repeated accessible content before the main content must be bypassable. Review whether keyboard users have a mechanism to skip repeated navigation and reach the main content.",
  },
  "ACT-R102": {
    title:
      "Document either has no repeated content, or a skip link as its first focusable element",
    detail:
      "A third check for skip-navigation availability. Ensure at least one bypass link exists near the top of the page for all views and page states.",
  },
  "ACT-R103": {
    title: "Text in widget has minimum contrast",
    detail:
      "This rule flags text whose contrast ratio falls below the required WCAG threshold. Check both foreground and background colours, including hover and focus states.",
  },
  "ACT-R104": {
    title: "Text in widget has enhanced contrast",
    detail:
      "Text identified by this rule meets AA contrast (4.5:1) but fails the AAA threshold (7:1). Improving contrast benefits users with low vision and those in poor lighting conditions.",
  },
  "ACT-R105": {
    title: "Multiple links with same text go to different destinations",
    detail:
      "When identical link labels lead to different pages, users cannot predict the destination. Disambiguate using aria-label, visually hidden context text, or more specific link text.",
  },
  "ACT-R106": {
    title: "Invalid ARIA usage detected",
    detail:
      "An ARIA attribute or role is used incorrectly on this element. Review the WAI-ARIA spec for the element's allowed roles and attributes and correct any violations.",
  },
  "ACT-R107": {
    title: "Custom interactive element not keyboard accessible",
    detail:
      'Elements with onclick handlers but no keyboard access (missing tabindex and keyboard event listeners) are invisible to keyboard-only users. Add tabindex="0" and onkeydown/onkeyup handlers.',
  },
  "ACT-R108": {
    title: "ARIA attributes are misused",
    detail:
      "One or more ARIA attributes are applied in a way that conflicts with the element's native role or the WAI-ARIA specification. Correct the attributes to restore accurate semantics.",
  },
  "ACT-R109": {
    title: "Page language does not match content",
    detail:
      "The lang attribute on the <html> element may not reflect the actual primary language of the page content, causing assistive technologies to mispronounce words.",
  },
  "ACT-R110": {
    title: "Role attribute has at least one valid value",
    detail:
      "Every role attribute must contain at least one valid non-abstract WAI-ARIA role value.",
  },
  "ACT-R111": {
    title: "Touch target is too small (enhanced threshold)",
    detail:
      "Interactive elements smaller than 44×44 px fail the WCAG AAA target size criterion. While 24×24 px is the AA minimum, the enhanced threshold of 44×44 px provides a significantly better experience on touch devices.",
  },
  "ACT-R112": {
    title: "Semantic structure is missing or incorrect",
    detail:
      "Content that lacks the correct semantic HTML structure (e.g., visual lists built with <div> instead of <ul>/<li>) is not interpreted correctly by screen readers and other assistive tools.",
  },
  "ACT-R113": {
    title: "Touch target size is too small (24×24 minimum)",
    detail:
      "Interactive elements must be at least 24×24 CSS pixels in size or have sufficient spacing between them so users with motor impairments can activate them without accidentally hitting adjacent targets.",
  },
  "ACT-R114": {
    title: "Page title is not descriptive",
    detail:
      "The <title> element exists but its text does not meaningfully describe the page. Titles should be unique across the site and clearly identify the page topic or purpose.",
  },
  "ACT-R115": {
    title: "Heading is not descriptive",
    detail:
      "A heading element's text is too vague (e.g., 'Section', 'Details') to convey the purpose of the content that follows. Headings should describe their section clearly without requiring surrounding context.",
  },
  "ACT-R116": {
    title: "Details/summary element missing accessible name",
    detail:
      "A <details> element requires a <summary> child with meaningful text. Without it, screen readers cannot announce the disclosure widget's purpose or current state.",
  },
  "ACT-R117": {
    title: "Element with role='img' has no accessible name",
    detail:
      'Any element with role="img" must provide an accessible name via aria-label or aria-labelledby so its content or purpose is conveyed to screen reader users.',
  },
  "ACT-R118": {
    title: "Does this image contain human-language text?",
    potentialTitle: "Does this image contain human-language text?",
    detail:
      "This experimental rule is manual-only. First ask whether the image contains visible text that expresses something in a human language. If yes, review whether the text is purely decorative, insignificant or incidental, essential to the presentation (for example, a logo), or redundant with regular text on the same page. A Potential Issue remains only when none of those exceptions applies.",
  },
  "ACT-R119": {
    title: "Fixed or sticky element may obscure keyboard focus",
    detail:
      "Fixed and sticky headers or footers must not hide content when keyboard focus moves to an element.",
  },
  "ACT-R121": {
    title: "Focus indicator suppressed without visible replacement",
    detail:
      "Do not remove the default focus indicator unless a visible replacement with sufficient contrast is provided.",
  },
  "ACT-R126": {
    title:
      "Accessible authentication — CAPTCHA may block users with cognitive disabilities",
    detail:
      "Authentication must provide an accessible alternative when a CAPTCHA or other cognitive-function test is used.",
  },
  "ACT-R120": {
    title: "Focus not fully visible — element may be partially obscured",
    detail:
      "Focused content must remain fully visible and must not be hidden behind fixed or sticky page content.",
  },
  "ACT-R122": {
    title: "Dragging interaction has no pointer alternative",
    detail:
      "Functionality that requires dragging must also be operable through a single-pointer alternative.",
  },
  "ACT-R124": {
    title: "Help mechanism not consistently located across pages",
    detail:
      "Help mechanisms that appear across pages should remain in a consistent relative location.",
  },
  "ACT-R125": {
    title: "User required to re-enter information already provided",
    detail:
      "Users should not be required to re-enter information already supplied during the same session.",
  },
  "ACT-R127": {
    title: "Accessible authentication — no cognitive function test permitted",
    detail:
      "Authentication must work without requiring a cognitive-function test.",
  },
  "ACT-R128": {
    title: "Abbreviations and acronyms should have their full expansion available",
    detail:
      "At first use, provide the full meaning of abbreviations and acronyms in visible text, an <abbr title>, or an equivalent glossary entry. Because the browser cannot determine whether a reader knows an abbreviation, matches are reported as Potential Issues for review.",
  },
};

// Keep documentation badges aligned with the API's WCAG_MAPPING and
// getLegalCompliance rules. EAA applies to WCAG A/AA criteria, not AAA-only,
// WAI-ARIA, or Best Practice checks.
const WCAG_RULE_METADATA: Record<string, { sc: string[]; level: string[] }> = {
  "ACT-R1": { sc: ["2.4.2"], level: ["A"] }, "ACT-R2": { sc: ["1.1.1"], level: ["A"] }, "ACT-R3": { sc: ["4.1.1"], level: ["A"] },
  "ACT-R4": { sc: ["3.1.1"], level: ["A"] }, "ACT-R5": { sc: ["3.1.1"], level: ["A"] }, "ACT-R6": { sc: ["3.1.1"], level: ["A"] },
  "ACT-R7": { sc: ["3.1.2"], level: ["AA"] }, "ACT-R8": { sc: ["1.3.1", "4.1.2"], level: ["A"] }, "ACT-R9": { sc: ["2.2.1"], level: ["A"] },
  "ACT-R10": { sc: ["1.3.5"], level: ["AA"] }, "ACT-R11": { sc: ["2.4.4"], level: ["A"] }, "ACT-R12": { sc: ["4.1.2"], level: ["A"] },
  "ACT-R13": { sc: ["4.1.2"], level: ["A"] }, "ACT-R14": { sc: ["2.5.3"], level: ["A"] }, "ACT-R15": { sc: ["2.4.1"], level: ["A"] },
  "ACT-R16": { sc: ["4.1.2"], level: ["WAI-ARIA"] }, "ACT-R17": { sc: ["4.1.2"], level: ["A"] }, "ACT-R18": { sc: ["4.1.2"], level: ["WAI-ARIA"] },
  "ACT-R19": { sc: ["4.1.2"], level: ["WAI-ARIA"] }, "ACT-R20": { sc: ["4.1.2"], level: ["WAI-ARIA"] }, "ACT-R21": { sc: ["4.1.2"], level: ["WAI-ARIA"] },
  "ACT-R22": { sc: ["1.2.2"], level: ["A"] }, "ACT-R23": { sc: ["1.2.1"], level: ["A"] }, "ACT-R24": { sc: ["1.2.3"], level: ["A"] },
  "ACT-R25": { sc: ["1.2.5"], level: ["AA"] }, "ACT-R26": { sc: ["1.2.1"], level: ["A"] }, "ACT-R27": { sc: ["1.2.2"], level: ["A"] },
  "ACT-R28": { sc: ["1.1.1", "4.1.2"], level: ["A"] }, "ACT-R29": { sc: ["1.2.1"], level: ["A"] }, "ACT-R30": { sc: ["1.2.1"], level: ["A"] },
  "ACT-R31": { sc: ["1.2.3"], level: ["A"] }, "ACT-R32": { sc: [], level: ["Best Practice"] }, "ACT-R33": { sc: ["1.2.1"], level: ["A"] },
  "ACT-R34": { sc: [], level: ["Best Practice"] }, "ACT-R35": { sc: ["1.2.1"], level: ["A"] }, "ACT-R36": { sc: ["4.1.2"], level: ["A"] },
  "ACT-R37": { sc: ["1.2.5"], level: ["AA"] }, "ACT-R38": { sc: ["1.2.3", "1.2.5", "1.2.8"], level: ["A", "AA", "AAA"] },
  "ACT-R39": { sc: ["1.1.1"], level: ["A"] }, "ACT-R40": { sc: ["1.3.1"], level: ["WAI-ARIA"] }, "ACT-R41": { sc: ["2.4.4"], level: ["A"] },
  "ACT-R42": { sc: ["1.3.1"], level: ["A"] }, "ACT-R43": { sc: ["4.1.2"], level: ["A"] }, "ACT-R44": { sc: ["1.3.4"], level: ["AA"] },
  "ACT-R45": { sc: ["1.3.1"], level: ["A"] }, "ACT-R46": { sc: ["1.3.1"], level: ["A"] }, "ACT-R47": { sc: ["1.4.4"], level: ["AA"] },
  "ACT-R48": { sc: ["1.4.2"], level: ["A"] }, "ACT-R49": { sc: ["1.4.2"], level: ["A"] }, "ACT-R50": { sc: ["1.4.2"], level: ["A"] },
  "ACT-R51": { sc: ["1.4.2"], level: ["A"] }, "ACT-R52": { sc: ["2.4.4"], level: ["A"] }, "ACT-R53": { sc: ["1.3.1"], level: ["A"] },
  "ACT-R54": { sc: ["4.1.3"], level: ["AA"] }, "ACT-R55": { sc: ["1.3.1"], level: ["A"] }, "ACT-R56": { sc: ["1.3.1"], level: ["A"] },
  "ACT-R57": { sc: [], level: ["ARIA APG"] }, "ACT-R58": { sc: ["2.4.1"], level: ["A"] }, "ACT-R59": { sc: ["1.3.1"], level: ["A"] },
  "ACT-R60": { sc: ["1.3.1"], level: ["A"] }, "ACT-R61": { sc: [], level: ["Best Practice"] }, "ACT-R62": { sc: ["1.4.1"], level: ["A"] },
  "ACT-R63": { sc: ["4.1.2"], level: ["A"] }, "ACT-R64": { sc: ["2.4.6"], level: ["AA"] }, "ACT-R65": { sc: ["2.4.7"], level: ["AA"] },
  "ACT-R66": { sc: ["1.4.6"], level: ["AAA"] }, "ACT-R67": { sc: ["1.1.1"], level: ["A"] }, "ACT-R68": { sc: ["1.3.1"], level: ["A"] },
  "ACT-R69": { sc: ["1.4.3"], level: ["AA"] }, "ACT-R70": { sc: ["4.1.1"], level: ["A"] }, "ACT-R71": { sc: ["1.4.8"], level: ["AAA"] },
  "ACT-R72": { sc: ["1.4.8"], level: ["AAA"] }, "ACT-R73": { sc: ["1.4.12"], level: ["AA"] }, "ACT-R74": { sc: ["1.4.4"], level: ["AA"] },
  "ACT-R75": { sc: ["1.4.4"], level: ["AA"] }, "ACT-R76": { sc: ["1.3.1"], level: ["A"] }, "ACT-R77": { sc: ["1.3.1"], level: ["A"] },
  "ACT-R78": { sc: ["2.4.6"], level: ["AA"] }, "ACT-R79": { sc: ["1.3.1"], level: ["A"] }, "ACT-R80": { sc: ["1.4.12"], level: ["AA"] },
  "ACT-R81": { sc: ["2.4.4"], level: ["A"] }, "ACT-R82": { sc: ["3.3.1"], level: ["A"] }, "ACT-R83": { sc: ["1.4.4"], level: ["AA"] },
  "ACT-R84": { sc: ["2.1.1"], level: ["A"] }, "ACT-R85": { sc: ["1.4.8"], level: ["AAA"] }, "ACT-R86": { sc: ["1.1.1"], level: ["A"] },
  "ACT-R87": { sc: ["2.4.1"], level: ["A"] }, "ACT-R88": { sc: ["1.4.3"], level: ["AA"] }, "ACT-R89": { sc: ["1.4.6"], level: ["AAA"] },
  "ACT-R90": { sc: ["4.1.2"], level: ["A"] }, "ACT-R91": { sc: ["1.4.12"], level: ["AA"] }, "ACT-R92": { sc: ["1.4.12"], level: ["AA"] },
  "ACT-R93": { sc: ["1.4.12"], level: ["AA"] }, "ACT-R94": { sc: ["4.1.2"], level: ["A"] }, "ACT-R95": { sc: ["2.1.1"], level: ["A"] },
  "ACT-R96": { sc: ["2.2.4", "3.2.5"], level: ["A"] }, "ACT-R97": { sc: ["2.4.1"], level: ["A"] }, "ACT-R98": { sc: ["2.4.1"], level: ["A"] },
  "ACT-R99": { sc: ["1.3.1"], level: ["A"] }, "ACT-R100": { sc: ["2.4.1"], level: ["A"] }, "ACT-R101": { sc: ["2.4.1"], level: ["A"] },
  "ACT-R102": { sc: ["2.4.1"], level: ["A"] }, "ACT-R103": { sc: ["1.4.3"], level: ["AA"] }, "ACT-R104": { sc: ["1.4.6"], level: ["AAA"] },
  "ACT-R105": { sc: [], level: ["Best Practice"] }, "ACT-R106": { sc: [], level: ["Best Practice"] }, "ACT-R107": { sc: [], level: ["Best Practice"] },
  "ACT-R108": { sc: [], level: ["Best Practice"] }, "ACT-R109": { sc: ["3.1.1"], level: ["A"] }, "ACT-R110": { sc: ["4.1.2"], level: ["A"] },
  "ACT-R111": { sc: ["2.5.5"], level: ["AAA"] }, "ACT-R112": { sc: [], level: ["Best Practice"] }, "ACT-R113": { sc: ["2.5.8"], level: ["AA"] },
  "ACT-R114": { sc: ["2.4.2"], level: ["A"] }, "ACT-R115": { sc: ["2.4.6"], level: ["AA"] }, "ACT-R116": { sc: ["4.1.2"], level: ["A"] },
  "ACT-R117": { sc: ["1.1.1"], level: ["A"] }, "ACT-R119": { sc: ["2.4.11"], level: ["AA"] }, "ACT-R120": { sc: ["2.4.12"], level: ["AAA"] },
  "ACT-R118": { sc: ["1.4.5", "1.4.9"], level: ["AA", "AAA"] },
  "ACT-R121": { sc: ["2.4.13"], level: ["AAA"] }, "ACT-R122": { sc: ["2.5.7"], level: ["AA"] }, "ACT-R124": { sc: ["3.2.6"], level: ["A"] },
   "ACT-R125": { sc: ["3.3.7"], level: ["A"] }, "ACT-R126": { sc: ["3.3.8"], level: ["AA"] }, "ACT-R127": { sc: ["3.3.9"], level: ["AAA"] },
   "ACT-R128": { sc: ["3.1.4"], level: ["AAA"] },
};

for (const [id, metadata] of Object.entries(WCAG_RULE_METADATA)) {
  const rule = ACT_RULES[id];
  if (rule) {
    rule.wcagCriteria = metadata.sc;
    rule.wcagLevel = metadata.level;
    rule.eaa = metadata.level.includes("A") || metadata.level.includes("AA");
    rule.ada = rule.eaa;
    rule.ruleType = metadata.level.includes("Best Practice")
      ? "Best Practice"
      : metadata.level.includes("WAI-ARIA")
        ? "WAI-ARIA"
        : "Issue";
  }
}

export default ACT_RULES;

export function getRuleTitle(
  ruleId: string,
  ruleType?: string | null,
  occurrenceDescription?: string | null,
): string {
  const rule = ACT_RULES[ruleId];
  if (!rule) return ruleId;
  if (
    ruleId === "ACT-R23" &&
    occurrenceDescription?.startsWith(
      "Is there an alternative to the visual content in this video?",
    )
  ) {
    return "Is there an alternative to the visual content in this video?";
  }
  if (ruleType === "Issue" && rule.issueTitle) return rule.issueTitle;
  if (ruleType === "Potential Issue" && rule.potentialTitle)
    return rule.potentialTitle;
  return rule.title;
}
