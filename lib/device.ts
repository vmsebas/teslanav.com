/**
 * Environment detection for the Tesla in-car browser.
 *
 * Tesla's 2026.26 update (Chromium 148) dropped the "Tesla" / "qtcarbrowser"
 * token from the user agent and renders the browser in a window that can be
 * much narrower than the physical panel (devicePixelRatio 1.53, so the CSS
 * viewport is ~1254x784, and a reduced window has been measured at ~773 CSS
 * px wide). Both UA sniffing and `window.innerWidth` therefore misfire: the
 * old check stopped recognizing the car and started tripping the phone
 * warning inside it.
 *
 * `screen.width` / `screen.height` report the physical panel in CSS pixels,
 * independent of the browser window size or zoom, so they stay reliable:
 * Tesla panels are large (>= ~780 CSS px on the short side) while phones are
 * ~360-430. We combine that with the pointer/touch capability and keep the
 * UA token only as a sufficient-but-not-necessary hint.
 */

export interface DetectedEnvironment {
  isTeslaBrowser: boolean;
  isRealMobile: boolean;
}

export function detectEnvironment(): DetectedEnvironment {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return { isTeslaBrowser: false, isRealMobile: false };
  }

  const ua = navigator.userAgent.toLowerCase();
  const uaIsTesla = ua.includes("tesla") || ua.includes("qtcarbrowser");
  const uaIsMobile =
    /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/.test(ua);

  const screenWidth = window.screen?.width ?? 0;
  const screenHeight = window.screen?.height ?? 0;
  const shortSide = Math.min(screenWidth, screenHeight);
  const longSide = Math.max(screenWidth, screenHeight);
  const hasTouch =
    (navigator.maxTouchPoints ?? 0) > 0 || "ontouchstart" in window;

  // Large touchscreen panel (Tesla, not a phone or a small tablet).
  const largeTouchPanel = shortSide >= 600 && longSide >= 1000 && hasTouch;

  const isTeslaBrowser = uaIsTesla || (largeTouchPanel && !uaIsMobile);

  // Only warn about actual phones: a mobile UA, or a genuinely small panel.
  // Desktops (no touch, large screen) and the car are both excluded.
  const isRealMobile = !isTeslaBrowser && (uaIsMobile || shortSide < 500);

  return { isTeslaBrowser, isRealMobile };
}
