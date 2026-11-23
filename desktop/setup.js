const form = document.querySelector("#connect-form");
const serverInput = document.querySelector("#server-url");
const connectButton = document.querySelector("#connect-button");
const message = document.querySelector("#connection-message");
const updateButton = document.querySelector("#update-button");
const updateMessage = document.querySelector("#update-message");

async function loadSavedServer() {
  try {
    serverInput.value = (await window.coderaxDesktop.getServerUrl()) || "";
  } catch {
    message.textContent = "The saved server address could not be loaded. Enter it again to continue.";
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.textContent = "";
  connectButton.disabled = true;
  connectButton.textContent = "Saving…";

  try {
    const result = await window.coderaxDesktop.connect(serverInput.value);
    if (!result.ok) {
      message.textContent = result.message;
      return;
    }
  } catch {
    message.textContent = "The server address could not be saved. Check it and try again.";
  } finally {
    connectButton.disabled = false;
    connectButton.textContent = "Save and open Coderax";
  }
});

updateButton.addEventListener("click", async () => {
  if (!window.coderaxDesktop?.checkForUpdates) {
    updateMessage.textContent = "This build cannot check for updates. Reinstall Coderax Desktop.";
    return;
  }

  updateButton.disabled = true;
  updateButton.textContent = "Checking…";
  updateMessage.textContent = "Checking GitHub for the latest desktop release…";

  try {
    const result = await window.coderaxDesktop.checkForUpdates();
    if (!result?.ok) {
      updateMessage.textContent = result?.message || "The update check failed. Try again.";
      return;
    }
    if (result.status === "current") {
      updateMessage.textContent = "You're running the latest desktop version.";
    } else if (result.status === "deferred") {
      updateMessage.textContent = "Update postponed. Choose Check for updates when you're ready.";
    } else if (result.status === "installing") {
      updateMessage.textContent = "Installing the update. Coderax will close and reopen.";
    }
  } catch {
    updateMessage.textContent = "The update check failed. Try again.";
  } finally {
    updateButton.disabled = false;
    updateButton.textContent = "Check for updates";
  }
});

void loadSavedServer();
