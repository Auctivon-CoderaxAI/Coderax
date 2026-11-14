const form = document.querySelector("#connect-form");
const serverInput = document.querySelector("#server-url");
const connectButton = document.querySelector("#connect-button");
const message = document.querySelector("#connection-message");

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

void loadSavedServer();
