# Hermes Personal WebUI

## Summary

An independent, mobile-first Hermes interface, inspired by official Desktop interactions and built on community WebUI capabilities. It remains distinct from Pi/Robin in runtime, credentials and conversation ownership.

Latest confirmed direction: restore Klein blue and white after the image-inspired and blue/green palette experiments. Remove green, warm gold and ivory. Retain the improved reading sizes, bar-free layout and mobile menu; this is a palette rollback, not a functional or typography rollback. No scenic imagery, particles, light trails or decorative gradients.

## Behavior

1. Hermes uses Klein-blue (#002FA7) sidebars/settings headers, a deeper blue icon rail and white conversation/reading surfaces, with high-contrast dark-blue text. No green/gold accents, scenic artwork, glow, grain or decorative gradients. Real transcripts, code, forms and input stay on opaque readable surfaces. Keep the enlarged reading sizes, editorial serif headings and legible sans-serif body text. Visual simplification never removes Memory, Skills, Kanban or other feature access.
2. Remove the entire redundant top bar. Desktop keeps icon navigation and the sidebar's new-conversation action; phones keep the original menu and new-conversation buttons as ≥44px floating controls. Settings remains in the icon menu, with translated accessible names/tooltips. Leave space so controls do not cover content, and preserve execution/approval/error/stop controls independently of the removed bar.
3. Navigation never sends a prompt or cancels a run merely because the user switches views.
4. Chat continues to expose messages, attachments, model selection, tool activity, approvals, cancellation and errors. Visual simplification must not hide an action requiring attention.
5. A new conversation has a quiet typographic empty state, not fabricated example messages or promotional suggestion cards. Saved prompts and regular conversation controls remain available.
6. When model readiness is unknown or missing, the user sees a truthful status and a route to configure it, not a false connected badge. Checking readiness must not itself initiate a paid model call.
7. The settings overview groups model/provider setup, account connections, tools/security, appearance and preferences. Advanced settings remain reachable.
8. Real provider and appearance controls retain their existing save behavior. Switching from the overview must not bypass protections for unsaved changes.
9. On phones the settings overview occupies the full viewport. It scrolls within its content, exposes a persistent return control, confines keyboard focus while open and restores focus on close. Escape closes it.
10. The Google account area must distinguish unavailable UI integration from a verified account connection. The first UI preview explicitly says the integration is not yet implemented and offers no pretend Connect/Disconnect action.
11. Later Google integration requests only the email/calendar capabilities the user authorizes. A grant of scopes is not consent to send arbitrary email or modify unrelated events. Send/reply, invitations and destructive changes require an explicit preview and confirmation.
12. Hermes never silently adopts Pi/Robin credentials. Using the same external Google account does not make Google data isolated: changes there can be visible to both applications.
13. “Open Pi” is ordinary URL navigation and carries no Hermes/Pi session, workspace or credentials. It is configurable, and missing/invalid configuration directs the user to settings instead of opening a broken destination.
14. A phone must not be told to use its own localhost to reach the Mac. A loopback default is only usable when accessing the UI through a loopback host.
15. Invalid Pi URLs fail visibly without replacing the last valid destination. Browser storage failure is reported; saving does not silently succeed.
16. New default styling is applied once; later explicit appearance choices survive refresh. Custom copy supports Chinese and English through the upstream locale preference, including settings, status and validation messages. Switching language updates the view and survives reload without introducing a second language setting.
17. Touch targets in new mobile controls are at least 44px. New text inputs use readable font sizes, with labels and visible validation feedback. Core actions cannot depend on hover alone.
18. Narrow and landscape layouts must not force horizontal document scrolling. Code/content may scroll within its own container where needed.
19. Reduced-motion preferences are respected. Text and status meaning must not rely solely on color.
20. Preview state starts separately from existing Hermes and Pi/Robin data. The user has now explicitly approved sharing the previously configured CLI HERMES_HOME: model authentication, tool configuration, memory, Skills, jobs and Agent-owned state are shared directly, not copied. WebUI login and its own session directory remain separate; Pi/Robin data and the default ~/.hermes are untouched. Shared-home edits affect CLI too. Sharing configuration alone does not authorize starting a scheduler. The user has subsequently approved Gateway startup and login-time supervision; preflight found no tasks. No scheduled job is created merely to enable the daemon.
21. Phone access is not claimed complete until a real phone can reach the protected deployment and recover after backgrounding or network interruption. A responsive screenshot is not that proof.
22. Closing the page or navigating to Pi is not represented as undoing completed actions. Backend availability, not the browser's appearance, determines whether ongoing work can continue.
23. The approved Gateway uses the shared CLI home and native macOS LaunchAgent supervision: start at user login and restart on abnormal exit, not a system daemon before login. WebUI detects its real local health; never hide a warning to simulate readiness. No additional HTTP listener, messaging integration or scheduled task is enabled by this setup. Sleeping/offline hardware is not promised to execute tasks on time.

## Delivery scope

The first implementation slice covers the new appearance, mobile navigation, settings overview, truthful Google placeholder, safe Pi link and readiness indication. Google authorization, enforced write confirmations, protected remote access and live model/tool lifecycle validation remain separate subsequent work; they must not be presented as completed with the visual preview.
