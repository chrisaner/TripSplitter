import { getExpenseDraft, updateExpenseDraft } from '../state/modalStore.js?v=20261024-trip1';
import { renderExpenseModal } from '../ui/expenseModalUI.js?v=20261024-trip1';
import { state } from '../state.js?v=20261024-trip1';
import { db, storage, ref, set, onValue, storageRef, uploadBytes, getDownloadURL } from '../firebase.js?v=20261024-trip1';
import { SUPPORTED_CURRENCIES } from '../state.js?v=20261024-trip1';
import { openModal } from '../modal.js?v=20261024-trip1';
import { getSyncContext } from './syncService.js?v=20261024-trip1';
import { reportError, showToast } from './errorService.js?v=20261024-trip1';
import { roomRequest } from './accountApi.js?v=20261024-trip1';
let stopWatching = null;
let receiptGeneration = 0;
export function stopOCRWatch() { receiptGeneration++;stopWatching?.();stopWatching=null; }

function normalizeCandidateAmount(candidate) {
  const text = `${candidate?.label || ''} ${candidate?.rawText || ''} ${candidate?.displayText || ''} ${candidate?.currencyText || ''}`;
  const thousandsMatch = text.match(/(?:¥|JPY|円)?\s*(\d{1,3}(?:,\d{3})+)(?:\.\d+)?/i);

  if (thousandsMatch) {
    const parsed = Number(thousandsMatch[1].replace(/,/g, ''));
    if (!Number.isNaN(parsed)) {
      return {
        ...candidate,
        amount: parsed
      };
    }
  }

  return candidate;
}

function normalizeOcrResult(result) {
  if (!result) return result;

  const normalized = { ...result };

  if (Array.isArray(normalized.candidates)) {
    normalized.candidates = normalized.candidates.map(normalizeCandidateAmount);
  }

  normalized.amount = normalizeCandidateAmount({
    amount: normalized.amount,
    rawText: normalized.rawText,
    label: normalized.label,
    displayText: normalized.displayText,
    currencyText: normalized.currency
  }).amount ?? normalized.amount;

  return normalized;
}

export function resetOCRState() {
  const draft = getExpenseDraft();

  updateExpenseDraft({
    ocr: {
      ...draft.ocr,
      status: 'idle',
      jobId: null,
      draftId: null,
      result: null,
      error: null
    }
  });

  renderExpenseModal();
}

export function updateOCRStatusUI() {
  renderExpenseModal();
}

export function applyOCRResult(result) {
  if (!result) return;

  const normalized = normalizeOcrResult(result);

  updateExpenseDraft({
    amount:
      normalized.amount != null && !Number.isNaN(Number(normalized.amount))
        ? String(normalized.amount)
        : '',
    currency:
      normalized.currency && SUPPORTED_CURRENCIES.includes(normalized.currency)
        ? normalized.currency
        : 'TWD',
    ocr: {
      ...getExpenseDraft().ocr,
      result: normalized
    }
  });

}

export function applyOCRCandidate(index) {
  const candidates = getExpenseDraft().ocr?.result?.candidates || [];
  const selected = candidates[index];
  if (!selected) return;

  applyOCRResult(selected);
}

export async function uploadReceiptAndStartOCR(file) {
  const { currentRoomId, currentUserUid } = getSyncContext();
  const generation=receiptGeneration;

  if (!currentRoomId || !currentUserUid) {
    updateExpenseDraft({
		ocr: {
			status: 'error',
			jobId: null,
			draftId: null,
			result: null,
			error: '尚未加入房間，無法啟動收據辨識'
		}
	});
	renderExpenseModal();
    updateOCRStatusUI();
    showToast('尚未加入房間，無法啟動收據辨識', 'warn');
    return;
  }

  try {
    const draftId = `draft_${Date.now()}`;
    const jobId = `job_${crypto.randomUUID()}`;

    updateExpenseDraft({
		ocr: {
			status: 'uploading',
			jobId,
			draftId,
			result: null,
			error: null
		}
	});
	renderExpenseModal();
    updateOCRStatusUI();

    const response = await roomRequest({action:'uploadReceipt',roomId:currentRoomId,image:getExpenseDraft().receipt});
    if(generation!==receiptGeneration || getSyncContext().currentUserUid!==currentUserUid || getSyncContext().currentRoomId!==currentRoomId)return;
    const actualJobId=response.jobId;

    updateExpenseDraft({
		ocr: {
			status: 'processing',
			jobId,
			draftId,
			result: null,
			error: null
		}
	});
	renderExpenseModal();
    updateOCRStatusUI();

    updateExpenseDraft({ocr:{...getExpenseDraft().ocr,jobId:actualJobId}});
    watchOCRJob(actualJobId);
  } catch (error) {
    if(generation!==receiptGeneration || getSyncContext().currentUserUid!==currentUserUid || getSyncContext().currentRoomId!==currentRoomId)return;
    reportError(error, {
      scope: 'ocrService.uploadReceiptAndStartOCR',
      level: 'error',
      userMessage: '收據辨識流程啟動失敗'
    });

    updateExpenseDraft({
		ocr: {
			status: 'error',
      jobId: null,
      draftId: null,
			result: null,
			error: null
		}
	});
	renderExpenseModal();
    updateOCRStatusUI();
  }
}

export function watchOCRJob(jobId) {
  const jobRef = ref(db, `ocrJobs/${jobId}`);
  stopOCRWatch();
  const generation=receiptGeneration;
  stopWatching=onValue(
    jobRef,
    (snapshot) => {
      if(generation!==receiptGeneration)return;
      try {
        const job = snapshot.val();
        if (!job) return;

        if (job.status === 'pending' || job.status === 'processing') {
          updateExpenseDraft({
            ocr: {
              ...getExpenseDraft().ocr,
              status: 'processing'
            }
          });
          renderExpenseModal();
          return;
        }

        if (job.status === 'done') {
          const normalized = normalizeOcrResult(job.result || null);

          updateExpenseDraft({
            ocr: {
              ...getExpenseDraft().ocr,
              status: 'done',
              result: normalized,
              error: null
            }
          });

          applyOCRResult(normalized);
          return;
        }

        if (job.status === 'error') {
          updateExpenseDraft({
            ocr: {
              ...getExpenseDraft().ocr,
              status: 'error',
              result: null,
              error: job.error || '無法辨識收據'
            }
          });
          renderExpenseModal();
          showToast('收據辨識失敗，請手動輸入', 'warn');
        }
      } catch (error) {
        reportError(error, {
          scope: 'ocrService.watchOCRJob.onValue',
          level: 'error',
          userMessage: 'OCR 結果解析失敗'
        });
      }
    },
    (error) => {
      reportError(error, {
        scope: 'ocrService.watchOCRJob',
        level: 'error',
        userMessage: '無法監聽辨識結果'
      });

      updateExpenseDraft({
        ocr: {
          ...getExpenseDraft().ocr,
          status: 'error',
          error: '無法監聽辨識結果'
        }
      });
      renderExpenseModal();
    }
  );
}


export function triggerReceiptUpload() {
  document.getElementById('receipt-input')?.click();
}

export async function handleReceiptFile(input) {
  if (input.files && input.files[0]) {
    const file = input.files[0];
    if(file.size>5*1024*1024 || !['image/jpeg','image/png','image/webp'].includes(file.type))return showToast('請使用 5 MB 以下的 JPEG、PNG 或 WebP 照片','warn');
    stopOCRWatch();const generation=receiptGeneration, account=getSyncContext();

    const reader = new FileReader();
    reader.onload = async (e) => {
      const context=getSyncContext();if(generation!==receiptGeneration || account.currentUserUid!==context.currentUserUid || account.currentRoomId!==context.currentRoomId)return;
      updateExpenseDraft({
        receipt: e.target.result
      });

      renderExpenseModal();
      await uploadReceiptAndStartOCR(file);
    };

    reader.readAsDataURL(file);
  }
}

export function removeReceipt() {
  stopOCRWatch();
  updateExpenseDraft({
    receipt: null,
    ocr: {
      status: 'idle',
      jobId: null,
      draftId: null,
      result: null,
      error: null
    }
  });

  const input = document.getElementById('receipt-input');
  if (input) input.value = '';

  renderExpenseModal();
}

export function viewFullReceipt() {
  const draft = getExpenseDraft();

  if (draft.receipt) {
    document.getElementById('full-receipt-display').src = draft.receipt;
    openModal('imageViewerModal');
  }
}
