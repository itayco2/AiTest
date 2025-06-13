# Backend/face_reconstruction.py
import numpy as np
import cv2
import trimesh
import mediapipe as mp
from typing import Dict, List, Tuple, Optional
import torch
import torch.nn as nn
from PIL import Image
import dlib
import logging
from fastapi import UploadFile
import io

logger = logging.getLogger(__name__)

class FaceReconstructor:
    """Handles 3D face reconstruction from 2D images"""
    
    def __init__(self):
        # Initialize MediaPipe Face Mesh
        self.mp_face_mesh = mp.solutions.face_mesh.FaceMesh(
            static_image_mode=True,
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.5
        )
        
        # Initialize face detector
        self.detector = dlib.get_frontal_face_detector()
        
        # Face landmarks predictor (download from dlib website)
        try:
            self.predictor = dlib.shape_predictor("models/shape_predictor_68_face_landmarks.dat")
        except:
            logger.warning("Dlib predictor not found, using MediaPipe only")
            self.predictor = None
        
        # Load FLAME model parameters (simplified version)
        self.flame_params = self._init_flame_params()
        
    def _init_flame_params(self) -> Dict:
        """Initialize FLAME face model parameters"""
        return {
            "shape_dims": 100,
            "expression_dims": 50,
            "pose_dims": 6,
            "vertices": 5023,
            "faces": self._load_flame_topology()
        }
    
    def _load_flame_topology(self) -> np.ndarray:
        """Load FLAME face topology (simplified)"""
        # In production, load actual FLAME topology
        # This is a placeholder
        return np.array([[0, 1, 2], [1, 2, 3]])  # Simplified
    
    async def process_face_image(self, image_file: UploadFile) -> Dict:
        """Process uploaded face image and generate 3D mesh"""
        try:
            # Read image
            contents = await image_file.read()
            nparr = np.frombuffer(contents, np.uint8)
            image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            # Convert to RGB for MediaPipe
            image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            
            # Detect face landmarks
            landmarks = self._detect_landmarks(image_rgb)
            
            if landmarks is None:
                raise ValueError("No face detected in image")
            
            # Generate 3D face mesh
            face_mesh = self._reconstruct_3d_face(landmarks, image_rgb)
            
            # Extract face texture
            texture = self._extract_face_texture(image_rgb, landmarks)
            
            # Align face mesh to SMPL head
            aligned_mesh = self._align_to_smpl_head(face_mesh)
            
            return {
                "face_mesh": aligned_mesh,
                "texture": texture,
                "landmarks": landmarks,
                "success": True
            }
            
        except Exception as e:
            logger.error(f"Face processing failed: {e}")
            return {
                "success": False,
                "error": str(e)
            }
    
    def _detect_landmarks(self, image: np.ndarray) -> Optional[np.ndarray]:
        """Detect facial landmarks using MediaPipe"""
        results = self.mp_face_mesh.process(image)
        
        if not results.multi_face_landmarks:
            return None
        
        # Extract first face landmarks
        face_landmarks = results.multi_face_landmarks[0]
        
        # Convert to numpy array
        h, w = image.shape[:2]
        landmarks = np.array([
            [lm.x * w, lm.y * h, lm.z * w]
            for lm in face_landmarks.landmark
        ])
        
        return landmarks
    
    def _reconstruct_3d_face(
        self, 
        landmarks: np.ndarray, 
        image: np.ndarray
    ) -> trimesh.Trimesh:
        """Reconstruct 3D face mesh from 2D landmarks"""
        
        # MediaPipe provides 468 face landmarks with depth
        vertices = landmarks.copy()
        
        # Normalize and center
        vertices -= vertices.mean(axis=0)
        
        # Scale to realistic face size (approximately 20cm height)
        current_height = vertices[:, 1].max() - vertices[:, 1].min()
        scale_factor = 0.2 / current_height  # 20cm target height
        vertices *= scale_factor
        
        # Create face topology (simplified version)
        # In production, use proper MediaPipe face mesh topology
        faces = self._create_face_topology(len(vertices))
        
        # Create trimesh
        face_mesh = trimesh.Trimesh(vertices=vertices, faces=faces)
        
        # Smooth the mesh
        face_mesh = self._smooth_mesh(face_mesh)
        
        return face_mesh
    
    def _create_face_topology(self, num_vertices: int) -> np.ndarray:
        """Create face mesh topology (triangulation)"""
        # This is a simplified Delaunay triangulation
        # In production, use MediaPipe's face mesh topology
        
        # For MediaPipe's 468 landmarks, we have predefined connections
        # Here's a simplified version
        faces = []
        
        # Example triangulation pattern (simplified)
        # In reality, MediaPipe has specific face triangulation
        for i in range(num_vertices - 2):
            if i % 2 == 0:
                faces.append([i, i + 1, i + 2])
            else:
                faces.append([i, i + 2, i + 1])
        
        return np.array(faces)
    
    def _smooth_mesh(self, mesh: trimesh.Trimesh, iterations: int = 5) -> trimesh.Trimesh:
        """Apply Laplacian smoothing to mesh"""
        vertices = mesh.vertices.copy()
        
        for _ in range(iterations):
            # Simple Laplacian smoothing
            new_vertices = vertices.copy()
            
            for i, vertex in enumerate(vertices):
                # Find connected vertices
                faces_with_vertex = np.where(mesh.faces == i)[0]
                connected_vertices = np.unique(mesh.faces[faces_with_vertex].flatten())
                connected_vertices = connected_vertices[connected_vertices != i]
                
                if len(connected_vertices) > 0:
                    # Average position of connected vertices
                    avg_pos = vertices[connected_vertices].mean(axis=0)
                    # Blend with original position
                    new_vertices[i] = 0.5 * vertex + 0.5 * avg_pos
            
            vertices = new_vertices
        
        mesh.vertices = vertices
        return mesh
    
    def _extract_face_texture(
        self, 
        image: np.ndarray, 
        landmarks: np.ndarray
    ) -> np.ndarray:
        """Extract face texture from image"""
        h, w = image.shape[:2]
        
        # Create mask for face region
        face_points = landmarks[:, :2].astype(np.int32)
        
        # Convex hull of face points
        hull = cv2.convexHull(face_points)
        
        # Create mask
        mask = np.zeros((h, w), dtype=np.uint8)
        cv2.fillPoly(mask, [hull], 255)
        
        # Extract face region
        face_texture = cv2.bitwise_and(image, image, mask=mask)
        
        # Crop to bounding box
        x, y, w, h = cv2.boundingRect(hull)
        face_texture = face_texture[y:y+h, x:x+w]
        
        # Resize to standard texture size
        face_texture = cv2.resize(face_texture, (512, 512))
        
        return face_texture
    
    def _align_to_smpl_head(self, face_mesh: trimesh.Trimesh) -> trimesh.Trimesh:
        """Align face mesh to SMPL avatar head"""
        # Define key landmark indices for alignment
        # These correspond to MediaPipe landmarks
        key_landmarks = {
            "nose_tip": 1,
            "left_eye": 33,
            "right_eye": 263,
            "mouth_center": 13,
            "chin": 152
        }
        
        # Get face mesh key points
        face_keypoints = np.array([
            face_mesh.vertices[key_landmarks["nose_tip"]],
            face_mesh.vertices[key_landmarks["left_eye"]],
            face_mesh.vertices[key_landmarks["right_eye"]]
        ])
        
        # Define target SMPL head key points (approximate)
        smpl_keypoints = np.array([
            [0, 0.1, 0.05],    # nose
            [-0.03, 0.12, 0.03],  # left eye
            [0.03, 0.12, 0.03]    # right eye
        ])
        
        # Calculate transformation matrix
        transform = self._calculate_alignment_transform(face_keypoints, smpl_keypoints)
        
        # Apply transformation
        face_mesh.apply_transform(transform)
        
        return face_mesh
    
    def _calculate_alignment_transform(
        self, 
        source_points: np.ndarray, 
        target_points: np.ndarray
    ) -> np.ndarray:
        """Calculate rigid transformation matrix"""
        # Center points
        source_center = source_points.mean(axis=0)
        target_center = target_points.mean(axis=0)
        
        source_centered = source_points - source_center
        target_centered = target_points - target_center
        
        # Calculate rotation using SVD
        H = source_centered.T @ target_centered
        U, _, Vt = np.linalg.svd(H)
        R = Vt.T @ U.T
        
        # Ensure proper rotation (det(R) = 1)
        if np.linalg.det(R) < 0:
            Vt[-1, :] *= -1
            R = Vt.T @ U.T
        
        # Calculate translation
        t = target_center - R @ source_center
        
        # Build 4x4 transformation matrix
        transform = np.eye(4)
        transform[:3, :3] = R
        transform[:3, 3] = t
        
        return transform
    
    def merge_face_with_avatar(
        self, 
        avatar_mesh: trimesh.Trimesh, 
        face_mesh: trimesh.Trimesh,
        blend_region: float = 0.05
    ) -> trimesh.Trimesh:
        """Merge face mesh with avatar head"""
        # Create a copy of avatar mesh
        merged_mesh = avatar_mesh.copy()
        
        # Find head vertices in avatar
        head_vertices_mask = self._find_head_region(avatar_mesh)
        
        # Replace head vertices with face mesh vertices
        # This is a simplified version - in production, use proper blending
        
        # Find corresponding vertices between face and head
        face_tree = trimesh.proximity.ProximityQuery(face_mesh)
        
        for i, is_head in enumerate(head_vertices_mask):
            if is_head:
                # Find closest face vertex
                closest, distance, _ = face_tree.vertex(
                    avatar_mesh.vertices[i].reshape(1, 3)
                )
                
                if distance[0] < blend_region:
                    # Blend between avatar and face vertex
                    blend_factor = 1.0 - (distance[0] / blend_region)
                    merged_mesh.vertices[i] = (
                        blend_factor * face_mesh.vertices[closest[0]] + 
                        (1 - blend_factor) * avatar_mesh.vertices[i]
                    )
        
        # Smooth the blend region
        merged_mesh = self._smooth_blend_region(merged_mesh, head_vertices_mask)
        
        return merged_mesh
    
    def _find_head_region(self, avatar_mesh: trimesh.Trimesh) -> np.ndarray:
        """Find vertices belonging to head region"""
        vertices = avatar_mesh.vertices
        
        # Simple height-based detection
        # Head is typically top 15% of avatar height
        max_y = vertices[:, 1].max()
        min_y = vertices[:, 1].min()
        height = max_y - min_y
        
        head_threshold = min_y + 0.85 * height
        head_mask = vertices[:, 1] > head_threshold
        
        return head_mask
    
    def _smooth_blend_region(
        self, 
        mesh: trimesh.Trimesh, 
        head_mask: np.ndarray
    ) -> trimesh.Trimesh:
        """Smooth the blending region between face and body"""
        vertices = mesh.vertices.copy()
        
        # Find boundary vertices (head vertices with non-head neighbors)
        boundary_vertices = []
        
        for i, is_head in enumerate(head_mask):
            if is_head:
                # Check if any neighbor is not in head
                faces_with_vertex = np.where(mesh.faces == i)[0]
                neighbor_vertices = np.unique(mesh.faces[faces_with_vertex].flatten())
                
                if any(not head_mask[v] for v in neighbor_vertices if v != i):
                    boundary_vertices.append(i)
        
        # Apply smoothing to boundary region
        for _ in range(10):  # Multiple iterations for smoother blend
            new_vertices = vertices.copy()
            
            for i in boundary_vertices:
                # Find connected vertices
                faces_with_vertex = np.where(mesh.faces == i)[0]
                connected = np.unique(mesh.faces[faces_with_vertex].flatten())
                connected = connected[connected != i]
                
                if len(connected) > 0:
                    # Weighted average based on distance
                    weights = 1.0 / (np.linalg.norm(
                        vertices[connected] - vertices[i], axis=1
                    ) + 1e-6)
                    weights /= weights.sum()
                    
                    new_vertices[i] = np.sum(
                        vertices[connected] * weights[:, np.newaxis], 
                        axis=0
                    )
            
            vertices = new_vertices
        
        mesh.vertices = vertices
        return mesh

# Utility functions for face processing
def create_face_texture_map(
    face_mesh: trimesh.Trimesh,
    face_image: np.ndarray
) -> Tuple[np.ndarray, np.ndarray]:
    """Create UV texture map for face mesh"""
    h, w = face_image.shape[:2]
    
    # Simple cylindrical UV mapping for face
    vertices = face_mesh.vertices
    
    # Calculate UV coordinates
    uv_coords = np.zeros((len(vertices), 2))
    
    # Cylindrical projection
    for i, vertex in enumerate(vertices):
        # U coordinate from angle around Y axis
        angle = np.arctan2(vertex[0], vertex[2])
        u = (angle + np.pi) / (2 * np.pi)
        
        # V coordinate from height
        v = (vertex[1] - vertices[:, 1].min()) / (
            vertices[:, 1].max() - vertices[:, 1].min()
        )
        
        uv_coords[i] = [u, v]
    
    # Create texture image
    texture_size = 1024
    texture = np.zeros((texture_size, texture_size, 3), dtype=np.uint8)
    
    # Sample face image to create texture
    for i, (u, v) in enumerate(uv_coords):
        # Convert UV to image coordinates
        img_x = int(u * w)
        img_y = int(v * h)
        
        # Convert UV to texture coordinates
        tex_x = int(u * texture_size)
        tex_y = int(v * texture_size)
        
        if 0 <= img_x < w and 0 <= img_y < h:
            texture[tex_y, tex_x] = face_image[img_y, img_x]
    
    # Inpaint missing regions
    mask = cv2.cvtColor(texture, cv2.COLOR_BGR2GRAY)
    mask = (mask == 0).astype(np.uint8) * 255
    texture = cv2.inpaint(texture, mask, 3, cv2.INPAINT_TELEA)
    
    return texture, uv_coords

def apply_face_texture(
    face_mesh: trimesh.Trimesh,
    texture: np.ndarray,
    uv_coords: np.ndarray
) -> trimesh.Trimesh:
    """Apply texture to face mesh"""
    # Create visual mesh with texture
    face_mesh.visual = trimesh.visual.TextureVisuals(
        uv=uv_coords,
        image=Image.fromarray(texture)
    )
    
    return face_mesh