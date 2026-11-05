/**
 * MULTI-ENGINE DISPATCHER & ADAPTER
 * Hỗ trợ phân phối tác vụ qua 3 nền tảng AI Video hàng đầu:
 *  1. Muse AI (muse.ai) - Tối ưu cho thoại, kịch bản tiếng Việt, tốc độ nhanh
 *  2. Google Flow (flow.google / Veo) - Tối ưu cho bối cảnh điện ảnh cao cấp, vật lý phức tạp
 *  3. Seedance (Seedance 2.0 / 2.5) - Tối ưu cho chuyển động nhân vật, nhất quán đa góc, tương tác vật lý mạnh
 */

const { runTask: runMuseTask, AUDIO_TEXT, stripAudio } = require('./muse-runner');
const gflowRunner = require('./gflow-runner');
const seedanceRunner = require('./seedance-runner');
const dolaRunner = require('./dola-runner');

const ENGINES = {
  MUSE: 'muse',
  GOOGLE_FLOW: 'google_flow',
  SEEDANCE: 'seedance',
  DOLA: 'dola',
  AUTO: 'auto'
};

/**
 * Phân tích độ nhạy của prompt để quyết định engine tối ưu
 * Nếu cảnh có va chạm vật lý mạnh (hất rượu, đánh đấm, rượt đuổi) -> Ưu tiên Google Flow / Seedance
 */
function recommendEngine(prompt) {
  if (!prompt || typeof prompt !== 'string') return ENGINES.MUSE;
  
  const highActionPatterns = /throw|hit|slap|fight|run|chase|wine|splash|tạt|hất|đánh|rơi|đổ|xô xát|va chạm/i;
  if (highActionPatterns.test(prompt)) {
    return ENGINES.GOOGLE_FLOW; // Cảnh khó -> Chuyển sang Google Flow / Veo
  }
  return ENGINES.MUSE; // Cảnh đối thoại / biểu cảm -> Muse
}

/**
 * Điều phối thực thi task với cơ chế dự phòng (Fallback)
 */
async function dispatchTask(task, context) {
  const provider = context.page?.provider || 'muse';
  const targetEngine = task.engine || ENGINES.AUTO;

  // QUY TẮC AN TOÀN QUOTA: Nếu task chỉ định rõ engine mà tài khoản được gán không khớp,
  // tuyệt đối KHÔNG fallback âm thầm sang Muse hay engine khác làm tiêu tốn quota sai mục đích!
  if (targetEngine !== ENGINES.AUTO && targetEngine !== provider) {
    throw new Error(`[MultiEngine] Task ${task.id} yêu cầu engine '${targetEngine}' nhưng tài khoản được gán là '${provider}'. Không được fallback sang engine khác để tránh tốn quota.`);
  }

  const chosen = targetEngine === ENGINES.AUTO 
    ? (provider !== 'muse' ? provider : recommendEngine(task.prompt)) 
    : targetEngine;

  console.log(`[MultiEngine] Task ${task.id} (provider=${provider}) điều hướng tới engine: ${chosen}`);

  try {
    // Âm thanh (Có tiếng / Không thoại / Tắt tiếng) cho Flow, Seedance, Dola: nối câu lệnh âm thanh thành đoạn cuối của prompt
    // (scene-helper coi đoạn sau cảnh cuối là phần kết chung → mọi cảnh đều nhận); Tắt tiếng thì gỡ tiếng sau khi tải.
    // Muse tự xử lý trong buildMessage của muse-runner.
    const withAudio = async run => {
      const text = AUDIO_TEXT[task.audio];
      const files = await run(text ? { ...task, prompt: `${String(task.prompt || '').trim()}\n\n${text}` } : task);
      if (task.audio === 'off' && Array.isArray(files) && task.kind !== 'image') {
        for (const f of files) if (typeof f === 'string' && /\.(mp4|mov|webm|m4v)$/i.test(f)) await stripAudio(f);
      }
      return files;
    };
    switch (chosen) {
      case ENGINES.GOOGLE_FLOW:
        return await withAudio(t => runGoogleFlowTask(t, context));

      case ENGINES.SEEDANCE:
        return await withAudio(t => runSeedanceTask(t, context));

      case ENGINES.DOLA:
        return await withAudio(t => runDolaTask(t, context));

      case ENGINES.MUSE:
      default:
        return await runMuseTask(task, context);
    }
  } catch (err) {
    if (err.museResult) {
      console.warn(`[MultiEngine] Muse từ chối task ${task.id}: ${err.message}`);
    }
    throw err;
  }
}

/**
 * Dola AI Runner (Dreamina Seedance 2.0 Fast trên dola.com)
 */
async function runDolaTask(task, context) {
  return await dolaRunner.runTask(task, context);
}

/**
 * Seedance 2.5 Runner (Hỗ trợ qua BytePlus Playground Web CDP hoặc ModelArk API Key)
 */
async function runSeedanceTask(task, context) {
  return await seedanceRunner.runTask(task, context);
}

/**
 * Google Flow Runner (Veo / flow.google)
 */
async function runGoogleFlowTask(task, context) {
  return await gflowRunner.runTask(task, context);
}

module.exports = {
  ENGINES,
  recommendEngine,
  dispatchTask,
  runGoogleFlowTask,
  runSeedanceTask,
  runDolaTask
};
