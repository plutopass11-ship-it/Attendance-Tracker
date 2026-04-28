const fs = require('fs');

// Fix admin.js
let adminContent = fs.readFileSync('js/admin.js', 'utf8');

adminContent = adminContent.replace(
    /<td style="min-width:100px;">[\s\S]*?<\/td>/,
    `<td style="min-width:80px;">
                    <button class="btn-small btn-primary" onclick="window.AdminUI.openEditLeaveModal('\${l.id}')" style="width:auto; padding:4px 12px; margin:0;">Edit</button>
                </td>`
);

adminContent = adminContent.replace(
    /const overlay = modal.querySelector\('\.modal-overlay'\);[\s\S]*?form.onsubmit = async \(e\) => {/,
    `const overlay = modal.querySelector('.modal-overlay');
        const deleteBtn = document.getElementById('delete-edit-leave-btn');

        closeBtn.onclick = () => modal.classList.add('hidden');
        overlay.onclick = () => modal.classList.add('hidden');

        if (deleteBtn) {
            deleteBtn.onclick = async () => {
                modal.classList.add('hidden');
                await window.AdminUI.deleteLeaveRecord(leave.id);
            };
        }

        form.onsubmit = async (e) => {`
);

fs.writeFileSync('js/admin.js', adminContent);

// Fix index.html
let htmlContent = fs.readFileSync('index.html', 'utf8');
htmlContent = htmlContent.replace(
    /<button type="button" class="btn-neutral" style="flex:1" id="close-edit-leave-modal">Cancel<\/button>/,
    `<button type="button" class="btn-neutral" style="flex:1" id="close-edit-leave-modal">Cancel</button>
                    <button type="button" class="btn-reject" style="flex:1; background:var(--danger); color:white; border:none; border-radius:8px; cursor:pointer;" id="delete-edit-leave-btn">Delete</button>`
);
// cache bust
htmlContent = htmlContent.replace(/\?v=25/g, '?v=26');

fs.writeFileSync('index.html', htmlContent);
