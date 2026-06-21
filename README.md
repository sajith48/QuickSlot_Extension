# ⚡ QuickSlots

QuickSlots is a modern **Multi Clipboard Chrome Extension** that helps users save, organize, and paste frequently used text instantly using keyboard shortcuts.

It is designed to improve productivity by providing multiple clipboard slots, recent history tracking, search functionality, and drag-and-drop slot reordering.

---

## ✨ Features

### 📋 Multi Clipboard Slots

- Save text into **4 different slots**
- Paste saved text instantly anywhere
- Persistent storage across browser sessions

### ⌨️ Keyboard Shortcuts

| Action | Shortcut |
|-------|----------|
| Save to Slot 1 | `Ctrl + Shift + 1` |
| Save to Slot 2 | `Ctrl + Shift + 2` |
| Save to Slot 3 | `Ctrl + Shift + 3` |
| Save to Slot 4 | `Ctrl + Shift + 4` |
| Paste Slot 1 | `Alt + Shift + 1` |
| Paste Slot 2 | `Alt + Shift + 2` |
| Paste Slot 3 | `Alt + Shift + 3` |
| Paste Slot 4 | `Alt + Shift + 4` |

---

### 🔍 Search Slots

- Quickly search saved slots
- Filter slots instantly while typing

---

### 🕒 Recent History

- Automatically stores recently saved text
- Keeps history organized
- Copy history items instantly
- Delete individual history items
- Clear all history with one click

---

### 🎯 Drag & Drop Reordering

- Reorder slots easily using drag & drop
- New order is saved automatically
- Smooth animations and visual feedback

---

### ✏️ Edit & Delete

- Edit slot content anytime
- Delete individual slots
- Clear all slots with a single click

---

## 🛠️ Technologies Used

- HTML5
- CSS3
- JavaScript (ES6)
- Chrome Extension Manifest V3
- Chrome Storage API
- Chrome Commands API
- Chrome Notifications API

---

## 📂 Project Structure

```text
QuickSlots/
│
├── manifest.json
├── background.js
├── content.js
│
├── popup.html
├── popup.css
├── popup.js
│
├── icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
│
└── README.md
```

---

## 🚀 Installation

### 1. Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/QuickSlots.git
```

### 2. Open Chrome Extensions

Go to:

```text
chrome://extensions
```

---

### 3. Enable Developer Mode

Turn ON **Developer Mode** from the top-right corner.

---

### 4. Load the Extension

Click:

```text
Load Unpacked
```

and select the **QuickSlots** folder.

---

### 5. Start Using

- Select any text
- Press:

```text
Ctrl + Shift + 1
```

to save.

- Click inside any input field and press:

```text
Alt + Shift + 1
```

to paste.



---

## 🚧 Challenges Faced

During development, I faced challenges with:

- Chrome Extension Manifest V3
- Keyboard shortcut registration
- Background and Content Script communication
- Clipboard access permissions
- Drag & Drop state management

These challenges helped me gain practical experience in browser extension development and Chrome APIs.

---

## 🚀 Future Improvements

- ☁️ Sync Across Devices
- 📌 Pinned Slots
- 🤖 AI Text Improvement
- 🌍 AI Translation
- 📝 AI Summarization
- 📤 Export / Import Backup

---

## 🔒 Privacy

QuickSlots does **not** collect, store, or share any personal information.

All user data is stored locally using Chrome Storage APIs.

---

## 👨‍💻 Author

**Sajith**

GitHub: https://github.com/sajith48

---

## ⭐ Support

If you like this project,

**Give it a ⭐ on GitHub!**
