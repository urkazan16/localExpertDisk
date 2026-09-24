use domain::VolumeInfo;
use std::collections::HashSet;

pub trait VolumeProvider {
    fn volumes(&self) -> Vec<VolumeInfo>;
}
pub struct LocalVolumes;

fn unique_mounts(mut volumes: Vec<VolumeInfo>) -> Vec<VolumeInfo> {
    volumes.sort_by(|a, b| {
        a.mount_point
            .cmp(&b.mount_point)
            .then_with(|| a.name.cmp(&b.name))
    });
    let mut mounts = HashSet::new();
    volumes.retain(|volume| {
        volume
            .mount_point
            .as_ref()
            .is_none_or(|mount| mounts.insert(mount.clone()))
    });
    volumes
}

impl VolumeProvider for LocalVolumes {
    fn volumes(&self) -> Vec<VolumeInfo> {
        let disks = sysinfo::Disks::new_with_refreshed_list();
        let volumes: Vec<_> = disks
            .list()
            .iter()
            .map(|disk| VolumeInfo {
                name: disk.name().to_string_lossy().into_owned(),
                mount_point: disk.mount_point().to_str().map(str::to_owned),
                filesystem: disk.file_system().to_string_lossy().into_owned(),
                total_bytes: disk.total_space().to_string(),
                available_bytes: disk.available_space().to_string(),
            })
            .collect();
        unique_mounts(volumes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn volume(name: &str, mount_point: Option<&str>) -> VolumeInfo {
        VolumeInfo {
            name: name.into(),
            mount_point: mount_point.map(str::to_owned),
            filesystem: "test".into(),
            total_bytes: "1".into(),
            available_bytes: "0".into(),
        }
    }

    #[test]
    fn presents_each_selectable_mount_point_once() {
        let volumes = unique_mounts(vec![
            volume("Macintosh HD - Data", Some("/")),
            volume("Macintosh HD", Some("/")),
            volume("External", Some("/Volumes/External")),
            volume("Unavailable A", None),
            volume("Unavailable B", None),
        ]);
        assert_eq!(
            volumes
                .iter()
                .filter_map(|volume| volume.mount_point.as_deref())
                .collect::<Vec<_>>(),
            vec!["/", "/Volumes/External"]
        );
        assert_eq!(volumes.len(), 4);
    }
}
