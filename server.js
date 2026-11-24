require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { db, getSetting, setSetting } = require('./db');
const yt = require('./services/youtube');
const ai = require('./services/aiResearch');
const audio = require('./services/audioEngine');
const { runProjectPipeline } = require('./services/videoPipeline');
const { runDailyWorkflow, startDailyScheduler } = require('./services/dailyManager');

const app = express();
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/status', (req, res) => {
  const token = db.prepare('SELECT expiry_date, scope FROM oauth_tokens WHERE id = 1').get();
  res.json({
    oauthConfigured: yt.isOAuthConfigured(),
    youtubeConnected: Boolean(token),
    aiConfigured: ai.isAIConfigured(),
    pexelsConfigured: Boolean(process.env.PEXELS_API_KEY && !process.env.PEXELS_API_KEY.startsWith('your_')),
    audioOnboarding: audio.getAudioOnboardingState()
  });
});

app.get('/api/auth/google', (req, res) => {
  try {
    res.json({ url: yt.getAuthUrl() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/auth/google/callback', async (req, res) => {
  try {
    if (!req.query.code) return res.status(400).send('Missing authorization code');
    await yt.handleOAuthCallback(req.query.code);
    await yt.syncChannelData();
    res.redirect('/');
  } catch (err) {
    res.status(500).send(`OAuth callback failed: ${err.message}`);
  }
});

app.post('/api/auth/disconnect', (req, res) => {
  yt.disconnectYouTube();
  res.json({ disconnected: true });
});

app.get('/api/dashboard', async (req, res) => {
  const channel = db.prepare('SELECT * FROM channel_profile LIMIT 1').get();
  const latestReport = db.prepare('SELECT * FROM daily_reports ORDER BY report_date DESC LIMIT 1').get();
  const nextScheduled = db.prepare(`SELECT * FROM video_projects WHERE status = 'scheduled' ORDER BY recommended_date ASC LIMIT 1`).get();
  const pendingApprovalCount = db.prepare(`SELECT COUNT(*) AS count FROM video_projects WHERE status = 'awaiting_approval'`).get().count;
  res.json({ channel, latestReport, nextScheduled, pendingApprovalCount });
});

app.post('/api/dashboard/sync', async (req, res) => {
  try {
    const data = await yt.syncChannelData();
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/projects', (req, res) => {
  const projects = db.prepare('SELECT * FROM video_projects ORDER BY created_at DESC').all();
  res.json({ projects });
});

app.post('/api/projects/:id/approve', async (req, res) => {
  const project = db.prepare('SELECT * FROM video_projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (project.status !== 'awaiting_approval') {
    return res.status(400).json({ error: 'Only projects awaiting approval can be approved.' });
  }
  try {
    db.prepare(`UPDATE video_projects SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(project.id);
    const updated = db.prepare('SELECT * FROM video_projects WHERE id = ?').get(project.id);
    const result = await yt.uploadApprovedVideo(updated);
    const finalStatus = result.scheduled ? 'scheduled' : 'uploaded';
    db.prepare(`UPDATE video_projects SET status = ?, youtube_video_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(finalStatus, result.videoId, project.id);
    res.json({ status: finalStatus, youtubeVideoId: result.videoId });
  } catch (err) {
    db.prepare(`UPDATE video_projects SET status = 'failed', error_message = ?, retry_count = retry_count + 1 WHERE id = ?`)
      .run(err.message, project.id);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects/:id/reject', (req, res) => {
  db.prepare(`UPDATE video_projects SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(req.params.id);
  res.json({ status: 'rejected' });
});

app.post('/api/projects/:id/retry', async (req, res) => {
  try {
    await runProjectPipeline(req.params.id);
    res.json({ status: 'awaiting_approval' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/comments', (req, res) => {
  const comments = db.prepare('SELECT * FROM comments_queue ORDER BY created_at DESC').all();
  res.json({ comments });
});

app.post('/api/comments/:id/approve-reply', async (req, res) => {
  const row = db.prepare('SELECT * FROM comments_queue WHERE comment_id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Comment not found' });
  try {
    const replyText = req.body.replyText || row.suggested_reply;
    await yt.postApprovedReply(row.comment_id, replyText);
    db.prepare(`UPDATE comments_queue SET status = 'posted', suggested_reply = ? WHERE comment_id = ?`).run(replyText, row.comment_id);
    res.json({ status: 'posted' });
  } catch (err) {
    db.prepare(`UPDATE comments_queue SET status = 'failed', error_message = ? WHERE comment_id = ?`).run(err.message, row.comment_id);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/audio/preferences', (req, res) => {
  res.json(audio.saveAudioPreferences(req.body));
});

app.post('/api/daily-manager/run', async (req, res) => {
  const result = await runDailyWorkflow();
  res.json(result);
});

app.get('/api/settings', (req, res) => {
  res.json({
    language: getSetting('language_preference', 'English'),
    niche: getSetting('channel_niche', 'AI & Creator Economy'),
    notifications: getSetting('notifications_enabled', true),
    privacyMode: getSetting('privacy_strict', true)
  });
});

app.post('/api/settings', (req, res) => {
  for (const [k, v] of Object.entries(req.body || {})) {
    setSetting(k, v);
  }
  res.json({ saved: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`YouTube AI Studio backend listening on port ${PORT}`);
  startDailyScheduler();
});
