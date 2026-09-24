use domain::VolumeInfo;

pub trait VolumeProvider {
    fn volumes(&self) -> Vec<VolumeInfo>;
}
pub struct LocalVolumes;
impl VolumeProvider for LocalVolumes {
    fn volumes(&self) -> Vec<VolumeInfo> {
        let disks = sysinfo::Disks::new_with_refreshed_list();
        let mut volumes: Vec<_> = disks
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
        volumes.sort_by(|a, b| a.mount_point.cmp(&b.mount_point));
        volumes
    }
}
