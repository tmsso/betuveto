import React from 'react';
import { useTranslation } from 'react-i18next';

const ConfirmationModal = ({ isOpen, onClose, onConfirm, message }) => {
  const { t } = useTranslation();
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[10000] p-4">
      <div className="bg-white rounded-xl shadow-2xl p-6 sm:p-8 max-w-sm w-full relative transform transition-all">
        <h3 className="text-2xl font-bold text-game-primary mb-4 text-center">{t('confirmModal.title')}</h3>
        <p className="text-gray-600 mb-8 text-center">{message}</p>
        <div className="flex justify-center gap-4">
          <button
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
