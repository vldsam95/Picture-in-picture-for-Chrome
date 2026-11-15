// All processing stays in the browser. No requests, tracking or stored data.
const pending = new Set();

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || pending.has(tab.id)) return;
  pending.add(tab.id);
  try {
    const frames = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: inspectVideos
    });
    const candidates = frames.filter(frame => frame.result?.count);
    candidates.sort((a, b) => b.result.score - a.result.score);
    if (!candidates.length) {
      await showError(tab.id, "לא נמצא סרטון מוכן. הפעילו את הסרטון בעמוד ונסו שוב.");
      return;
    }
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [candidates[0].frameId] },
      func: togglePictureInPicture
    });
    const result = results[0]?.result;
    if (!result?.ok) await showError(tab.id, result?.message || "לא ניתן לפתוח את הסרטון בחלון צף.");
    else {
      await chrome.action.setBadgeText({tabId: tab.id, text: ""});
      await chrome.action.setTitle({tabId: tab.id, title: "Picture to Picture — פתיחה / סגירה של חלון צף"});
    }
  } catch (error) {
    console.warn("Picture to Picture:", error.message);
    await showError(tab.id, "לא ניתן להפעיל כאן. פתחו עמוד רגיל עם סרטון ונסו שוב.");
  } finally {
    pending.delete(tab.id);
  }
});

function inspectVideos() {
  const videos = [];
  function visit(root) {
    for (const element of root.querySelectorAll("*")) {
      if (element.tagName === "VIDEO") videos.push(element);
      if (element.shadowRoot) visit(element.shadowRoot);
    }
  }
  visit(document);
  if (document.pictureInPictureElement) return {count: 1, score: 1e15};
  const ready = videos.filter(v => v.readyState >= 1 && v.videoWidth > 0);
  const score = (video) => {
    const r = video.getBoundingClientRect();
    const style = getComputedStyle(video);
    const visible = r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    const area = Math.min(r.width * r.height, 1e8);
    return (!video.paused && !video.ended ? 1e10 : 0) + (visible ? 1e9 : 0) + area;
  };
  return {count: ready.length, score: ready.length ? Math.max(...ready.map(score)) : 0};
}

async function togglePictureInPicture() {
  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
      return {ok: true};
    }
    if (!document.pictureInPictureEnabled) {
      return {ok: false, message: "הנגן או האתר מגבילים פתיחה בחלון צף."};
    }
    const videos = [];
    function visit(root) {
      for (const el of root.querySelectorAll("*")) {
        if (el.tagName === "VIDEO" && el.readyState >= 1 && el.videoWidth > 0) videos.push(el);
        if (el.shadowRoot) visit(el.shadowRoot);
      }
    }
    visit(document);
    const score = (v) => {
      const r = v.getBoundingClientRect();
      const style = getComputedStyle(v);
      const visible = r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      return (!v.paused && !v.ended ? 1e10 : 0) + (visible ? 1e9 : 0) + Math.min(r.width * r.height, 1e8);
    };
    videos.sort((a, b) => score(b) - score(a));
    const video = videos[0];
    if (!video) return {ok: false, message: "הפעילו את הסרטון בעמוד ונסו שוב."};
    const disabled = video.disablePictureInPicture;
    try {
      video.disablePictureInPicture = false;
      await video.requestPictureInPicture();
    } finally {
      video.disablePictureInPicture = disabled;
    }
    return {ok: true};
  } catch (error) {
    return {ok: false, message: error.name === "NotAllowedError"
      ? "לחצו על ניגון בעמוד ואז לחצו שוב על התוסף."
      : "הסרטון לא זמין לחלון צף כרגע. הפעילו אותו ונסו שוב."};
  }
}

async function showError(tabId, message) {
  await Promise.allSettled([
    chrome.action.setBadgeText({tabId, text: "!"}),
    chrome.action.setBadgeBackgroundColor({tabId, color: "#b45309"}),
    chrome.action.setTitle({tabId, title: message}),
    chrome.scripting.executeScript({target: {tabId}, func: (text) => {
      document.getElementById("picture-to-picture-message")?.remove();
      const host = document.createElement("div");
      host.id = "picture-to-picture-message";
      host.style.cssText = "position:fixed!important;top:20px!important;right:20px!important;z-index:2147483647!important";
      const root = host.attachShadow({mode: "closed"});
      const box = document.createElement("div");
      box.dir = "rtl";
      box.textContent = text;
      box.style.cssText = "background:#142238;color:white;padding:18px 22px;border-radius:14px;font:16px/1.6 Arial;max-width:350px;box-shadow:0 8px 35px #0005;cursor:pointer";
      box.onclick = () => host.remove();
      root.append(box);
      (document.body || document.documentElement).append(host);
      setTimeout(() => host.remove(), 6500);
    }, args: [message]})
  ]);
}
