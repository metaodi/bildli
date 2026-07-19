/**
 * Bildli - Client-side JavaScript
 * Handles card flipping interaction and image error fallback
 */

document.addEventListener("DOMContentLoaded", () => {
  const cards = document.querySelectorAll(".player-card");
  const body = document.body;
  const backdrop = document.createElement("div");
  let activeCard = null;

  backdrop.className = "card-modal-backdrop";
  backdrop.hidden = true;
  body.appendChild(backdrop);

  function closeActiveCard() {
    if (!activeCard) return;

    activeCard.classList.remove("flipped", "modal-open");
    activeCard.setAttribute("aria-expanded", "false");
    body.classList.remove("card-modal-open");
    backdrop.hidden = true;
    activeCard.focus();
    activeCard = null;
  }

  function openCard(card) {
    if (activeCard === card) {
      closeActiveCard();
      return;
    }

    if (activeCard) {
      activeCard.classList.remove("flipped", "modal-open");
      activeCard.setAttribute("aria-expanded", "false");
    }

    activeCard = card;
    activeCard.classList.add("modal-open", "flipped");
    activeCard.setAttribute("aria-expanded", "true");
    body.classList.add("card-modal-open");
    backdrop.hidden = false;
    activeCard.focus();
  }

  cards.forEach((card) => {
    card.addEventListener("click", () => {
      openCard(card);
    });

    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;

      event.preventDefault();
      openCard(card);
    });
  });

  backdrop.addEventListener("click", closeActiveCard);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeActiveCard();
    }
  });

  // Fallback for broken player images
  const avatarImages = document.querySelectorAll(".avatar-img");
  avatarImages.forEach((img) => {
    img.addEventListener("error", () => {
      const parent = img.parentElement;
      if (parent) {
        img.remove();
        const span = document.createElement("span");
        span.className = "avatar-emoji";
        span.textContent = "⚽";
        parent.appendChild(span);
      }
    });
  });
});
