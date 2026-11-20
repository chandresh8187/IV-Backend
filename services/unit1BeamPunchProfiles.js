const beamPunchProfiles = {"w_panel_1":"Left edge","w_panel_2":"Left outer slope","w_panel_3":"Left raised rib","w_panel_4":"Left inner slope","w_panel_5":"Centre channel","w_panel_6":"Right inner slope","w_panel_7":"Right raised rib","w_panel_8":"Right outer slope","w_panel_9":"Right edge"};
const isBeamPunchProfile = value => value === "beam" || Object.hasOwn(beamPunchProfiles, value);
module.exports = { beamPunchProfiles, isBeamPunchProfile };
