import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

// ROADMAP Batch 10 accessibility pass: role="dialog" + aria-modal + aria-labelledby tell a
// screen reader a dialog appeared and what it's called; without them the modal's text is
// just more page content, easy to miss since nothing else changed on screen. Focus moves
// to the cancel button on open (the safer of the two actions) and back to whatever
// triggered the modal on close, since the trigger is otherwise stranded behind an overlay
// it can no longer see. Escape closes it, matching every native dialog's behaviour.
const ConfirmationModal = ({ isOpen, onClose, onConfirm, message }) => {
  const { t } = useTranslation();
  const cancelButtonRef = useRef(null);
  const previouslyFocusedRef = useRef(null);
  // Latest-ref pattern: the timer that drives the game clock re-renders App (and so
  // recreates its inline onClose) every 500ms while a game is active — exactly when this
  // modal can be open. Keeping onClose out of the effect's own deps means the effect only
  // (re)runs when isOpen actually flips, not on every tick, so focus doesn't visibly jump
  // to the cancel button and back every half-second.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!isOpen) return;
    previouslyFocusedRef.current = document.activeElement;
    cancelButtonRef.current?.focus();

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocusedRef.current?.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[10000] p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        className="bg-white rounded-xl shadow-2xl p-6 sm:p-8 max-w-sm w-full relative transform transition-all"
      >
        <h3 id="confirm-modal-title" className="text-2xl font-bold text-game-primary mb-4 text-center">{t('confirmModal.title')}</h3>
        <p className="text-gray-600 mb-8 text-center">{message}</p>
        <div className="flex justify-center gap-4">
          <button
            ref={cancelButtonRef}
            onClick={onClose}
            className="px-6 py-2 rounded-full border-2 border-gray-300 text-gray-700 font-semibold hover:bg-gray-100 transition-colors"
          >
            {t('confirmModal.cancel')}
          </button>
          <button
            onClick={() => {
              onConfirm();
              onClose();
            }}
             className="px-6 py-2 rounded-full bg-red-500 text-white font-semibold hover:bg-red-600 transition-colors shadow-md"
          >
            {t('confirmModal.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmationModal;
