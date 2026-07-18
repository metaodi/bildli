/**
 * Bildli - Client-side JavaScript
 * Handles card flipping interaction and image error fallback
 */

document.addEventListener("DOMContentLoaded", () => {
  // Card flip on click
  const cards = document.querySelectorAll(".player-card");
  cards.forEach((card) => {
    card.addEventListener("click", () => {
      card.classList.toggle("flipped");
    });
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
